-- =====================================================================
-- 003 — Espinha dorsal: Evento → Turno → Posto → Alocação → Apontamento
-- M4 (eventos e postos), M5 (escala) e M6 (campo)
-- =====================================================================

CREATE TYPE status_evento AS ENUM ('planejamento','confirmado','em_execucao','encerrado','fechado','cancelado');

CREATE TABLE evento (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  cliente_id       uuid NOT NULL REFERENCES cliente(id),
  oportunidade_id  uuid REFERENCES oportunidade(id),
  praca_id         uuid NOT NULL REFERENCES praca(id),
  nome             text NOT NULL,
  marca            text,
  descricao        text,
  local_nome       text,
  endereco         text,
  latitude         numeric(9,6),
  longitude        numeric(9,6),
  status           status_evento NOT NULL DEFAULT 'planejamento',
  is_template      boolean NOT NULL DEFAULT false,
  clonado_de       uuid REFERENCES evento(id),
  -- regras de campo (M6) — configuráveis por evento
  qr_segredo       bytea NOT NULL DEFAULT gen_random_bytes(32),
  exige_qr         boolean NOT NULL DEFAULT true,     -- false = check-in só pelo link
  exige_geolocalizacao boolean NOT NULL DEFAULT false,
  raio_geo_m       integer NOT NULL DEFAULT 300,
  exige_selfie     boolean NOT NULL DEFAULT false,
  tolerancia_atraso_min smallint NOT NULL DEFAULT 10,
  checkin_antecedencia_min smallint NOT NULL DEFAULT 120,
  metas            jsonb NOT NULL DEFAULT '{}'::jsonb, -- {abordagens: 2000, leads: 500, degustacoes: ...}
  requisitos       jsonb NOT NULL DEFAULT '{}'::jsonb, -- uniforme, treinamento, alimentação, transporte, kit
  fechado_em       timestamptz,
  fechado_por      uuid REFERENCES usuario(id),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER trg_evento_atualizado BEFORE UPDATE ON evento
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE INDEX ix_evento_tenant_status ON evento (tenant_id, status);

-- Supervisor enxerga só os eventos sob sua responsabilidade
CREATE TABLE evento_supervisor (
  evento_id  uuid NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  PRIMARY KEY (evento_id, usuario_id)
);

CREATE TABLE turno (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evento_id  uuid NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  nome       text NOT NULL,                 -- 'Sábado — tarde'
  inicio     timestamptz NOT NULL,
  fim        timestamptz NOT NULL,
  CHECK (fim > inicio),
  CHECK (fim - inicio <= interval '24 hours')
);
CREATE INDEX ix_turno_evento ON turno (evento_id, inicio);

CREATE TABLE posto (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  turno_id       uuid NOT NULL REFERENCES turno(id) ON DELETE CASCADE,
  funcao_id      uuid NOT NULL REFERENCES funcao(id),
  quantidade     smallint NOT NULL CHECK (quantidade > 0),
  diaria_custo   numeric(10,2) NOT NULL CHECK (diaria_custo >= 0),  -- o que se paga ao profissional
  diaria_venda   numeric(10,2) NOT NULL CHECK (diaria_venda >= 0),  -- o que se cobra do cliente
  uniforme       text,
  -- requisitos de casting usados no cruzamento (todos opcionais):
  -- {altura_min, altura_max, generos:[], idade_min, idade_max, idiomas:[], exige_cnh:true,
  --  locomocao:['carro_proprio'], tamanhos_camiseta:['P','M'], nivel_min}
  requisitos     jsonb NOT NULL DEFAULT '{}'::jsonb,
  justificativa_vaga_aberta text,          -- critério de aceite 1
  criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_posto_turno ON posto (turno_id);

CREATE TYPE status_alocacao AS ENUM ('convidado','confirmado','recusado','cancelado','substituido');
CREATE TYPE tipo_alocacao   AS ENUM ('titular','suplente');

CREATE TABLE alocacao (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  posto_id          uuid NOT NULL REFERENCES posto(id) ON DELETE CASCADE,
  profissional_id   uuid NOT NULL REFERENCES profissional(id),
  tipo              tipo_alocacao NOT NULL DEFAULT 'titular',
  status            status_alocacao NOT NULL DEFAULT 'convidado',
  periodo           tstzrange NOT NULL,     -- copiado do turno por trigger (base da trava de conflito)
  convidado_em      timestamptz NOT NULL DEFAULT now(),
  respondido_em     timestamptz,
  motivo            text,                   -- recusa, cancelamento, substituição
  substitui_id      uuid REFERENCES alocacao(id),
  criado_por        uuid REFERENCES usuario(id),
  criado_em         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (posto_id, profissional_id),
  -- CRITÉRIO DE ACEITE 2: o banco recusa a mesma pessoa em dois lugares ao mesmo tempo
  CONSTRAINT sem_conflito_horario EXCLUDE USING gist (
    profissional_id WITH =,
    periodo WITH &&
  ) WHERE (status IN ('convidado','confirmado') AND tipo = 'titular')
);
CREATE INDEX ix_alocacao_posto ON alocacao (posto_id, status);
CREATE INDEX ix_alocacao_prof ON alocacao (profissional_id, status);

-- Copia o período do turno e impede exceder a quantidade de vagas do posto
CREATE OR REPLACE FUNCTION trg_alocacao_preparar() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_qtd smallint; v_ocupadas int; v_periodo tstzrange; v_tenant uuid;
BEGIN
  SELECT tstzrange(t.inicio, t.fim, '[)'), p.quantidade, p.tenant_id
    INTO v_periodo, v_qtd, v_tenant
    FROM posto p JOIN turno t ON t.id = p.turno_id
   WHERE p.id = NEW.posto_id;
  NEW.periodo := v_periodo;
  NEW.tenant_id := COALESCE(NEW.tenant_id, v_tenant);

  IF NEW.tipo = 'titular' AND NEW.status IN ('convidado','confirmado')
     AND (TG_OP = 'INSERT' OR OLD.status NOT IN ('convidado','confirmado') OR OLD.tipo <> 'titular') THEN
    SELECT count(*) INTO v_ocupadas FROM alocacao
     WHERE posto_id = NEW.posto_id AND tipo = 'titular'
       AND status IN ('convidado','confirmado') AND id <> NEW.id;
    IF v_ocupadas >= v_qtd THEN
      RAISE EXCEPTION 'Posto lotado: % de % vagas já ocupadas', v_ocupadas, v_qtd
        USING ERRCODE = 'P0001', HINT = 'Adicione como suplente ou aumente a quantidade do posto.';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('confirmado','recusado') AND NEW.respondido_em IS NULL THEN
    NEW.respondido_em := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_alocacao_preparar BEFORE INSERT OR UPDATE ON alocacao
  FOR EACH ROW EXECUTE FUNCTION trg_alocacao_preparar();

-- Se o horário do turno mudar, as alocações acompanham (e a trava de conflito reavalia)
CREATE OR REPLACE FUNCTION trg_turno_propagar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.inicio <> OLD.inicio OR NEW.fim <> OLD.fim THEN
    UPDATE alocacao a SET periodo = tstzrange(NEW.inicio, NEW.fim, '[)')
      FROM posto p WHERE p.id = a.posto_id AND p.turno_id = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_turno_propagar AFTER UPDATE ON turno
  FOR EACH ROW EXECUTE FUNCTION trg_turno_propagar();

-- Apontamento: o que realmente aconteceu
CREATE TYPE status_presenca AS ENUM ('previsto','presente','falta','falta_justificada');

CREATE TABLE apontamento (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  alocacao_id          uuid NOT NULL UNIQUE REFERENCES alocacao(id) ON DELETE CASCADE,
  status               status_presenca NOT NULL DEFAULT 'previsto',
  checkin_em           timestamptz,         -- hora do servidor (vale para cálculo)
  checkin_dispositivo_em timestamptz,       -- hora do celular (check-in offline sincronizado depois)
  checkin_metodo       text CHECK (checkin_metodo IN ('qr','link','supervisor')),
  checkin_lat          numeric(9,6),
  checkin_lng          numeric(9,6),
  checkin_selfie_url   text,
  checkout_em          timestamptz,
  checkout_dispositivo_em timestamptz,
  checkout_metodo      text CHECK (checkout_metodo IN ('qr','link','supervisor')),
  atraso_min           integer NOT NULL DEFAULT 0,
  saida_antecipada_min integer NOT NULL DEFAULT 0,
  suspeito             boolean NOT NULL DEFAULT false,   -- divergência relógio celular × servidor, fora do raio etc.
  observacao           text,
  registrado_por       uuid REFERENCES usuario(id),
  atualizado_em        timestamptz NOT NULL DEFAULT now(),
  CHECK (checkout_em IS NULL OR checkin_em IS NULL OR checkout_em > checkin_em)
);
CREATE TRIGGER trg_apontamento_atualizado BEFORE UPDATE ON apontamento
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- Avaliação por job (nota + observação) — alimenta o cruzamento e o BI
CREATE TABLE avaliacao (
  alocacao_id   uuid PRIMARY KEY REFERENCES alocacao(id) ON DELETE CASCADE,
  nota          smallint NOT NULL CHECK (nota BETWEEN 1 AND 5),
  observacao    text,
  avaliado_por  uuid REFERENCES usuario(id),
  avaliado_em   timestamptz NOT NULL DEFAULT now()
);

-- Ocorrências de campo
CREATE TABLE ocorrencia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evento_id     uuid NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  alocacao_id   uuid REFERENCES alocacao(id),
  tipo          text NOT NULL CHECK (tipo IN ('uniforme','conduta','incidente_publico','material','atraso','substituicao','outro')),
  gravidade     smallint NOT NULL DEFAULT 1 CHECK (gravidade BETWEEN 1 AND 3),
  descricao     text NOT NULL,
  fotos         text[] NOT NULL DEFAULT '{}',
  registrado_por uuid REFERENCES usuario(id),
  registrado_em timestamptz NOT NULL DEFAULT now()
);

-- Checklist de produção (M4)
CREATE TABLE checklist_item (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evento_id      uuid NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  descricao      text NOT NULL,
  responsavel_id uuid REFERENCES usuario(id),
  prazo          date,
  concluido_em   timestamptz
);

-- ---------------------------------------------------------------------
-- Trava de edição após o fechamento do evento (M5)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION evento_de_registro(p_tabela text, p_row jsonb) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE v uuid;
BEGIN
  CASE p_tabela
    WHEN 'turno' THEN v := (p_row->>'evento_id')::uuid;
    WHEN 'posto' THEN SELECT t.evento_id INTO v FROM turno t WHERE t.id = (p_row->>'turno_id')::uuid;
    WHEN 'alocacao' THEN SELECT t.evento_id INTO v FROM posto p JOIN turno t ON t.id = p.turno_id
                          WHERE p.id = (p_row->>'posto_id')::uuid;
    WHEN 'apontamento' THEN SELECT t.evento_id INTO v FROM alocacao a JOIN posto p ON p.id = a.posto_id
                          JOIN turno t ON t.id = p.turno_id WHERE a.id = (p_row->>'alocacao_id')::uuid;
  END CASE;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION trg_bloquear_evento_fechado() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_evento uuid; v_status status_evento;
BEGIN
  -- reabertura controlada: a função reabrir_evento liga esta flag na transação
  IF current_setting('app.permitir_edicao_fechado', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  v_evento := evento_de_registro(TG_TABLE_NAME, to_jsonb(COALESCE(NEW, OLD)));
  SELECT status INTO v_status FROM evento WHERE id = v_evento;
  IF v_status = 'fechado' THEN
    RAISE EXCEPTION 'Evento fechado: edição bloqueada (%).', TG_TABLE_NAME
      USING ERRCODE = 'P0002', HINT = 'Reabra o evento com justificativa para alterar.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER trg_trava_turno       BEFORE INSERT OR UPDATE OR DELETE ON turno       FOR EACH ROW EXECUTE FUNCTION trg_bloquear_evento_fechado();
CREATE TRIGGER trg_trava_posto       BEFORE INSERT OR UPDATE OR DELETE ON posto       FOR EACH ROW EXECUTE FUNCTION trg_bloquear_evento_fechado();
CREATE TRIGGER trg_trava_alocacao    BEFORE INSERT OR UPDATE OR DELETE ON alocacao    FOR EACH ROW EXECUTE FUNCTION trg_bloquear_evento_fechado();
CREATE TRIGGER trg_trava_apontamento BEFORE INSERT OR UPDATE OR DELETE ON apontamento FOR EACH ROW EXECUTE FUNCTION trg_bloquear_evento_fechado();

-- Quadro de vagas: previsto × ocupado por posto
CREATE OR REPLACE VIEW vw_quadro_vagas AS
SELECT e.tenant_id, e.id AS evento_id, e.nome AS evento, t.id AS turno_id, t.nome AS turno,
       t.inicio, t.fim, p.id AS posto_id, f.nome AS funcao, p.quantidade,
       count(a.id) FILTER (WHERE a.tipo='titular' AND a.status='confirmado') AS confirmados,
       count(a.id) FILTER (WHERE a.tipo='titular' AND a.status='convidado')  AS aguardando,
       count(a.id) FILTER (WHERE a.tipo='suplente' AND a.status IN ('convidado','confirmado')) AS suplentes,
       p.quantidade - count(a.id) FILTER (WHERE a.tipo='titular' AND a.status IN ('convidado','confirmado')) AS vagas_abertas,
       p.justificativa_vaga_aberta
  FROM evento e
  JOIN turno t ON t.evento_id = e.id
  JOIN posto p ON p.turno_id = t.id
  JOIN funcao f ON f.id = p.funcao_id
  LEFT JOIN alocacao a ON a.posto_id = p.id
 GROUP BY e.tenant_id, e.id, e.nome, t.id, t.nome, t.inicio, t.fim, p.id, f.nome, p.quantidade, p.justificativa_vaga_aberta;

-- Clonagem de evento como template (M4): copia turnos e postos deslocando as datas
CREATE OR REPLACE FUNCTION clonar_evento(p_origem uuid, p_novo_inicio timestamptz, p_nome text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_novo uuid; v_delta interval; r record; v_turno uuid;
BEGIN
  SELECT p_novo_inicio - min(inicio) INTO v_delta FROM turno WHERE evento_id = p_origem;
  INSERT INTO evento (tenant_id, cliente_id, oportunidade_id, praca_id, nome, marca, descricao, local_nome, endereco,
                      latitude, longitude, exige_qr, exige_geolocalizacao, raio_geo_m, exige_selfie,
                      tolerancia_atraso_min, checkin_antecedencia_min, metas, requisitos, clonado_de)
  SELECT tenant_id, cliente_id, NULL, praca_id, COALESCE(p_nome, nome || ' (cópia)'), marca, descricao, local_nome, endereco,
         latitude, longitude, exige_qr, exige_geolocalizacao, raio_geo_m, exige_selfie,
         tolerancia_atraso_min, checkin_antecedencia_min, metas, requisitos, id
    FROM evento WHERE id = p_origem
  RETURNING id INTO v_novo;

  FOR r IN SELECT * FROM turno WHERE evento_id = p_origem ORDER BY inicio LOOP
    INSERT INTO turno (tenant_id, evento_id, nome, inicio, fim)
    VALUES (r.tenant_id, v_novo, r.nome, r.inicio + COALESCE(v_delta, '0'), r.fim + COALESCE(v_delta, '0'))
    RETURNING id INTO v_turno;
    INSERT INTO posto (tenant_id, turno_id, funcao_id, quantidade, diaria_custo, diaria_venda, uniforme, requisitos)
    SELECT tenant_id, v_turno, funcao_id, quantidade, diaria_custo, diaria_venda, uniforme, requisitos
      FROM posto WHERE turno_id = r.id;
  END LOOP;

  INSERT INTO checklist_item (tenant_id, evento_id, descricao, responsavel_id)
  SELECT tenant_id, v_novo, descricao, responsavel_id FROM checklist_item WHERE evento_id = p_origem;
  RETURN v_novo;
END $$;
