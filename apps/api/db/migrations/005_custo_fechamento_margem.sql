-- =====================================================================
-- 005 — M7 Custo, fechamento do evento, pagamento, faturamento e margem
-- Critério de aceite 1: não fecha com posto em aberto sem justificativa.
-- Critério de aceite 3: o fechamento gera, a partir do apontamento, a
-- lista de valores a pagar e a margem do job.
-- =====================================================================

-- Regras de cálculo por empresa (podem ser sobrescritas por cliente no futuro)
CREATE TABLE regra_custo (
  tenant_id               uuid PRIMARY KEY REFERENCES tenant(id) ON DELETE CASCADE,
  hora_extra_pct          numeric(5,2) NOT NULL DEFAULT 50,     -- +50% sobre o valor-hora
  tolerancia_extra_min    smallint     NOT NULL DEFAULT 15,     -- abaixo disso não paga extra
  adicional_noturno_pct   numeric(5,2) NOT NULL DEFAULT 20,
  noturno_inicio          time         NOT NULL DEFAULT '22:00',
  noturno_fim             time         NOT NULL DEFAULT '05:00',
  desconta_atraso         boolean      NOT NULL DEFAULT false,  -- desconto proporcional acima da tolerância
  paga_saida_antecipada   boolean      NOT NULL DEFAULT false,  -- false = desconta proporcional
  arredondamento_min      smallint     NOT NULL DEFAULT 15      -- extra contado em blocos de N min
);

-- Lançamentos avulsos por alocação: deslocamento, ajuda de custo, bônus, descontos
CREATE TABLE lancamento_adicional (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  alocacao_id  uuid NOT NULL REFERENCES alocacao(id) ON DELETE CASCADE,
  tipo         text NOT NULL CHECK (tipo IN ('deslocamento','ajuda_custo','alimentacao','bonus','desconto','outro')),
  valor        numeric(10,2) NOT NULL,       -- desconto em valor negativo
  repassa_cliente boolean NOT NULL DEFAULT false,
  descricao    text,
  criado_por   uuid REFERENCES usuario(id),
  criado_em    timestamptz NOT NULL DEFAULT now()
);

-- Custos diretos do evento (uniforme, transporte, material, impressão...)
CREATE TABLE fornecedor (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  categoria  text NOT NULL CHECK (categoria IN ('uniforme','transporte','material','impressao','alimentacao','outro')),
  documento  text,
  contato    text
);

CREATE TABLE custo_direto (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evento_id     uuid NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  fornecedor_id uuid REFERENCES fornecedor(id),
  descricao     text NOT NULL,
  valor         numeric(12,2) NOT NULL CHECK (valor >= 0),
  repassa_cliente boolean NOT NULL DEFAULT false,
  vencimento    date,
  pago_em       date
);

-- Snapshot do cálculo por alocação, gerado no fechamento (imutável após fechar)
CREATE TABLE custo_alocacao (
  alocacao_id        uuid PRIMARY KEY REFERENCES alocacao(id) ON DELETE CASCADE,
  tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evento_id          uuid NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  profissional_id    uuid NOT NULL REFERENCES profissional(id),
  presenca           status_presenca NOT NULL,
  horas_contratadas  numeric(6,2) NOT NULL,
  horas_trabalhadas  numeric(6,2) NOT NULL DEFAULT 0,
  minutos_extra      integer NOT NULL DEFAULT 0,
  minutos_noturnos   integer NOT NULL DEFAULT 0,
  valor_diaria       numeric(10,2) NOT NULL DEFAULT 0,
  valor_extra        numeric(10,2) NOT NULL DEFAULT 0,
  valor_noturno      numeric(10,2) NOT NULL DEFAULT 0,
  valor_descontos    numeric(10,2) NOT NULL DEFAULT 0,   -- atraso / saída antecipada (negativo)
  valor_adicionais   numeric(10,2) NOT NULL DEFAULT 0,   -- lançamentos avulsos
  valor_total        numeric(10,2) NOT NULL DEFAULT 0,
  memoria_calculo    jsonb NOT NULL DEFAULT '{}'::jsonb, -- transparência para o profissional e auditoria
  calculado_em       timestamptz NOT NULL DEFAULT now()
);

-- Pagamento ao profissional (lote PIX, recibo/RPA)
CREATE TYPE status_pagamento AS ENUM ('pendente','em_lote','pago','cancelado');

CREATE TABLE lote_pagamento (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  descricao   text NOT NULL,
  data_prevista date NOT NULL,
  status      text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto','enviado','pago')),
  criado_por  uuid REFERENCES usuario(id),
  criado_em   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pagamento_profissional (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evento_id       uuid NOT NULL REFERENCES evento(id),
  profissional_id uuid NOT NULL REFERENCES profissional(id),
  valor           numeric(12,2) NOT NULL,
  status          status_pagamento NOT NULL DEFAULT 'pendente',
  lote_id         uuid REFERENCES lote_pagamento(id),
  chave_pix       text,                    -- snapshot no momento do fechamento
  recibo_url      text,
  pago_em         timestamptz,
  comprovante_url text,
  UNIQUE (evento_id, profissional_id)
);

-- Faturamento ao cliente (a nota fiscal é emitida no emissor externo; aqui fica o dado pronto)
CREATE TABLE fatura_cliente (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  evento_id      uuid NOT NULL UNIQUE REFERENCES evento(id),
  cliente_id     uuid NOT NULL REFERENCES cliente(id),
  valor_postos   numeric(12,2) NOT NULL,
  valor_repasses numeric(12,2) NOT NULL DEFAULT 0,
  valor_total    numeric(12,2) NOT NULL,
  itens          jsonb NOT NULL,
  vencimento     date NOT NULL,
  numero_nf      text,
  recebido_em    date,
  status         text NOT NULL DEFAULT 'a_emitir' CHECK (status IN ('a_emitir','emitida','recebida','cancelada'))
);

-- ---------------------------------------------------------------------
-- Minutos de um intervalo que caem na faixa noturna (no fuso da empresa)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION minutos_noturnos(p_inicio timestamptz, p_fim timestamptz,
                                            p_ini time, p_fim_not time, p_tz text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d date; total numeric := 0; n_ini timestamptz; n_fim timestamptz;
BEGIN
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim <= p_inicio THEN RETURN 0; END IF;
  FOR d IN SELECT generate_series((p_inicio AT TIME ZONE p_tz)::date - 1, (p_fim AT TIME ZONE p_tz)::date, '1 day')::date LOOP
    n_ini := (d + p_ini) AT TIME ZONE p_tz;
    n_fim := CASE WHEN p_fim_not <= p_ini THEN (d + 1 + p_fim_not) ELSE (d + p_fim_not) END AT TIME ZONE p_tz;
    total := total + GREATEST(0, extract(epoch FROM (LEAST(p_fim, n_fim) - GREATEST(p_inicio, n_ini))));
  END LOOP;
  RETURN floor(total / 60);
END $$;

-- ---------------------------------------------------------------------
-- Cálculo do custo de uma alocação a partir do apontamento
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calcular_custo_alocacao(p_alocacao uuid)
RETURNS custo_alocacao LANGUAGE plpgsql AS $$
DECLARE
  r record; rc regra_custo%ROWTYPE; c custo_alocacao%ROWTYPE;
  v_horas_contr numeric; v_valor_hora numeric; v_ini timestamptz; v_fim timestamptz;
  v_min_trab int; v_min_extra int; v_desc numeric := 0;
BEGIN
  SELECT a.id, a.tenant_id, a.profissional_id, t.evento_id, t.inicio, t.fim, p.diaria_custo,
         COALESCE(ap.status, 'falta'::status_presenca) AS presenca,
         ap.checkin_em, ap.checkout_em, ap.atraso_min, ap.saida_antecipada_min,
         e.tolerancia_atraso_min, tn.fuso_horario
    INTO r
    FROM alocacao a
    JOIN posto p ON p.id = a.posto_id
    JOIN turno t ON t.id = p.turno_id
    JOIN evento e ON e.id = t.evento_id
    JOIN tenant tn ON tn.id = a.tenant_id
    LEFT JOIN apontamento ap ON ap.alocacao_id = a.id
   WHERE a.id = p_alocacao;

  SELECT * INTO rc FROM regra_custo WHERE tenant_id = r.tenant_id;
  IF NOT FOUND THEN rc := ROW(r.tenant_id, 50, 15, 20, '22:00', '05:00', false, false, 15)::regra_custo; END IF;

  v_horas_contr := extract(epoch FROM (r.fim - r.inicio)) / 3600.0;
  v_valor_hora  := r.diaria_custo / NULLIF(v_horas_contr, 0);

  c.alocacao_id := r.id; c.tenant_id := r.tenant_id; c.evento_id := r.evento_id;
  c.profissional_id := r.profissional_id; c.presenca := r.presenca;
  c.horas_contratadas := round(v_horas_contr, 2);
  c.calculado_em := now();

  IF r.presenca = 'presente' THEN
    -- período efetivo: do check-in (ou início do turno, se chegou antes) até o check-out (ou fim do turno)
    v_ini := GREATEST(r.checkin_em, r.inicio);
    v_fim := COALESCE(r.checkout_em, r.fim);
    v_min_trab := GREATEST(0, floor(extract(epoch FROM (v_fim - v_ini)) / 60));
    c.horas_trabalhadas := round(v_min_trab / 60.0, 2);

    -- hora extra: além do fim do turno, acima da tolerância, em blocos
    v_min_extra := GREATEST(0, floor(extract(epoch FROM (v_fim - r.fim)) / 60));
    IF v_min_extra <= rc.tolerancia_extra_min THEN v_min_extra := 0;
    ELSE v_min_extra := (v_min_extra / rc.arredondamento_min) * rc.arredondamento_min; END IF;
    c.minutos_extra := v_min_extra;

    c.valor_diaria := r.diaria_custo;
    c.valor_extra  := round(v_valor_hora * (v_min_extra / 60.0) * (1 + rc.hora_extra_pct / 100), 2);

    c.minutos_noturnos := minutos_noturnos(v_ini, v_fim, rc.noturno_inicio, rc.noturno_fim, r.fuso_horario);
    c.valor_noturno := round(v_valor_hora * (c.minutos_noturnos / 60.0) * (rc.adicional_noturno_pct / 100), 2);

    IF rc.desconta_atraso AND r.atraso_min > r.tolerancia_atraso_min THEN
      v_desc := v_desc - round(v_valor_hora * r.atraso_min / 60.0, 2);
    END IF;
    IF NOT rc.paga_saida_antecipada AND r.saida_antecipada_min > 0 THEN
      v_desc := v_desc - round(v_valor_hora * r.saida_antecipada_min / 60.0, 2);
    END IF;
    c.valor_descontos := GREATEST(v_desc, -r.diaria_custo);
  END IF;

  SELECT COALESCE(sum(valor), 0) INTO c.valor_adicionais
    FROM lancamento_adicional WHERE alocacao_id = r.id
     AND (r.presenca = 'presente' OR tipo = 'desconto');

  c.valor_total := GREATEST(0, c.valor_diaria + c.valor_extra + c.valor_noturno + c.valor_descontos + c.valor_adicionais);
  c.memoria_calculo := jsonb_build_object(
    'diaria', r.diaria_custo, 'valor_hora', round(v_valor_hora, 4),
    'checkin', r.checkin_em, 'checkout', r.checkout_em, 'turno', jsonb_build_object('inicio', r.inicio, 'fim', r.fim),
    'atraso_min', r.atraso_min, 'saida_antecipada_min', r.saida_antecipada_min,
    'regra', to_jsonb(rc) - 'tenant_id');

  INSERT INTO custo_alocacao VALUES (c.*)
  ON CONFLICT (alocacao_id) DO UPDATE SET
    presenca = EXCLUDED.presenca, horas_contratadas = EXCLUDED.horas_contratadas,
    horas_trabalhadas = EXCLUDED.horas_trabalhadas, minutos_extra = EXCLUDED.minutos_extra,
    minutos_noturnos = EXCLUDED.minutos_noturnos, valor_diaria = EXCLUDED.valor_diaria,
    valor_extra = EXCLUDED.valor_extra, valor_noturno = EXCLUDED.valor_noturno,
    valor_descontos = EXCLUDED.valor_descontos, valor_adicionais = EXCLUDED.valor_adicionais,
    valor_total = EXCLUDED.valor_total, memoria_calculo = EXCLUDED.memoria_calculo,
    calculado_em = EXCLUDED.calculado_em;
  RETURN c;
END $$;

-- Prévia do fechamento (não grava nada definitivo além do snapshot recalculável)
CREATE OR REPLACE FUNCTION pendencias_fechamento(p_evento uuid)
RETURNS TABLE (tipo text, descricao text, referencia uuid) LANGUAGE sql STABLE AS $$
  SELECT 'vaga_aberta', format('%s — %s: %s vaga(s) aberta(s) sem justificativa', q.turno, q.funcao, q.vagas_abertas), q.posto_id
    FROM vw_quadro_vagas q
   WHERE q.evento_id = p_evento AND q.vagas_abertas > 0 AND coalesce(trim(q.justificativa_vaga_aberta), '') = ''
  UNION ALL
  SELECT 'convite_sem_resposta', format('%s ainda não respondeu à convocação (%s)', pr.nome, t.nome), a.id
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
    JOIN profissional pr ON pr.id = a.profissional_id
   WHERE t.evento_id = p_evento AND a.status = 'convidado' AND a.tipo = 'titular'
  UNION ALL
  SELECT 'checkout_pendente', format('%s fez check-in sem check-out (%s)', pr.nome, t.nome), a.id
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
    JOIN profissional pr ON pr.id = a.profissional_id
    JOIN apontamento ap ON ap.alocacao_id = a.id
   WHERE t.evento_id = p_evento AND ap.checkin_em IS NOT NULL AND ap.checkout_em IS NULL
$$;

-- ---------------------------------------------------------------------
-- Fechamento do evento
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fechar_evento(p_evento uuid, p_aceitar_checkout_pendente boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE e evento%ROWTYPE; v_pend int; v_aloc record; v_receita numeric; v_repasses numeric;
        v_custo_equipe numeric; v_custo_direto numeric; v_itens jsonb;
BEGIN
  SELECT * INTO e FROM evento WHERE id = p_evento FOR UPDATE;
  IF e.status = 'fechado' THEN RAISE EXCEPTION 'Evento já fechado' USING ERRCODE = 'P0002'; END IF;
  IF e.status IN ('cancelado','planejamento') THEN
    RAISE EXCEPTION 'Evento em status % não pode ser fechado', e.status USING ERRCODE = 'P0006';
  END IF;

  -- critério de aceite 1
  SELECT count(*) INTO v_pend FROM pendencias_fechamento(p_evento)
   WHERE tipo IN ('vaga_aberta','convite_sem_resposta')
      OR (tipo = 'checkout_pendente' AND NOT p_aceitar_checkout_pendente);
  IF v_pend > 0 THEN
    RAISE EXCEPTION 'Fechamento bloqueado: % pendência(s). Consulte pendencias_fechamento().', v_pend
      USING ERRCODE = 'P0007';
  END IF;

  -- confirmados sem apontamento viram falta
  INSERT INTO apontamento (tenant_id, alocacao_id, status, observacao)
  SELECT a.tenant_id, a.id, 'falta', 'falta registrada no fechamento (sem check-in)'
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
   WHERE t.evento_id = p_evento AND a.status = 'confirmado' AND a.tipo = 'titular'
  ON CONFLICT (alocacao_id) DO UPDATE SET status = 'falta'
   WHERE apontamento.status = 'previsto' AND apontamento.checkin_em IS NULL;

  -- custo por alocação (inclui substituídos que chegaram a trabalhar)
  FOR v_aloc IN
    SELECT a.id FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
     WHERE t.evento_id = p_evento AND a.tipo = 'titular' AND a.status IN ('confirmado','substituido')
  LOOP
    PERFORM calcular_custo_alocacao(v_aloc.id);
  END LOOP;

  -- valores a pagar por profissional (soma dos turnos)
  INSERT INTO pagamento_profissional (tenant_id, evento_id, profissional_id, valor, chave_pix)
  SELECT c.tenant_id, c.evento_id, c.profissional_id, sum(c.valor_total), pr.chave_pix
    FROM custo_alocacao c JOIN profissional pr ON pr.id = c.profissional_id
   WHERE c.evento_id = p_evento
   GROUP BY c.tenant_id, c.evento_id, c.profissional_id, pr.chave_pix
  HAVING sum(c.valor_total) > 0
  ON CONFLICT (evento_id, profissional_id) DO UPDATE SET valor = EXCLUDED.valor
   WHERE pagamento_profissional.status = 'pendente';

  -- faturamento ao cliente: pelo POSTO CONTRATADO (quantidade × diária de venda)
  SELECT COALESCE(sum(p.quantidade * p.diaria_venda), 0),
         COALESCE(jsonb_agg(jsonb_build_object('turno', t.nome, 'funcao', f.nome, 'quantidade', p.quantidade,
                                               'diaria', p.diaria_venda, 'subtotal', p.quantidade * p.diaria_venda)
                            ORDER BY t.inicio, f.nome), '[]')
    INTO v_receita, v_itens
    FROM posto p JOIN turno t ON t.id = p.turno_id JOIN funcao f ON f.id = p.funcao_id
   WHERE t.evento_id = p_evento;

  SELECT COALESCE((SELECT sum(valor) FROM custo_direto WHERE evento_id = p_evento AND repassa_cliente), 0)
       + COALESCE((SELECT sum(l.valor) FROM lancamento_adicional l JOIN custo_alocacao c ON c.alocacao_id = l.alocacao_id
                    WHERE c.evento_id = p_evento AND l.repassa_cliente), 0)
    INTO v_repasses;

  INSERT INTO fatura_cliente (tenant_id, evento_id, cliente_id, valor_postos, valor_repasses, valor_total, itens, vencimento)
  SELECT e.tenant_id, e.id, e.cliente_id, v_receita, v_repasses, v_receita + v_repasses, v_itens,
         current_date + c.prazo_pagamento_dias
    FROM cliente c WHERE c.id = e.cliente_id
  ON CONFLICT (evento_id) DO UPDATE SET valor_postos = EXCLUDED.valor_postos, valor_repasses = EXCLUDED.valor_repasses,
         valor_total = EXCLUDED.valor_total, itens = EXCLUDED.itens
   WHERE fatura_cliente.status = 'a_emitir';

  UPDATE evento SET status = 'fechado', fechado_em = now(), fechado_por = app_usuario() WHERE id = p_evento;

  SELECT COALESCE(sum(valor_total), 0) INTO v_custo_equipe FROM custo_alocacao WHERE evento_id = p_evento;
  SELECT COALESCE(sum(valor), 0) INTO v_custo_direto FROM custo_direto WHERE evento_id = p_evento;

  RETURN jsonb_build_object(
    'evento_id', p_evento,
    'receita', v_receita + v_repasses,
    'custo_equipe', v_custo_equipe,
    'custos_diretos', v_custo_direto,
    'margem', v_receita + v_repasses - v_custo_equipe - v_custo_direto,
    'margem_pct', round(100 * (v_receita + v_repasses - v_custo_equipe - v_custo_direto) / NULLIF(v_receita + v_repasses, 0), 2),
    'pagamentos', (SELECT jsonb_agg(jsonb_build_object('profissional', pr.nome, 'valor', pg.valor) ORDER BY pr.nome)
                     FROM pagamento_profissional pg JOIN profissional pr ON pr.id = pg.profissional_id
                    WHERE pg.evento_id = p_evento));
END $$;

-- Reabertura controlada (só com justificativa; fica na auditoria)
CREATE OR REPLACE FUNCTION reabrir_evento(p_evento uuid, p_motivo text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 10 THEN
    RAISE EXCEPTION 'Reabertura exige justificativa (mín. 10 caracteres)' USING ERRCODE = 'P0004';
  END IF;
  IF EXISTS (SELECT 1 FROM pagamento_profissional WHERE evento_id = p_evento AND status IN ('em_lote','pago')) THEN
    RAISE EXCEPTION 'Há pagamentos já enviados/pagos; reabertura bloqueada' USING ERRCODE = 'P0008';
  END IF;
  PERFORM set_config('app.motivo', p_motivo, true);
  UPDATE evento SET status = 'encerrado', fechado_em = NULL, fechado_por = NULL WHERE id = p_evento AND status = 'fechado';
END $$;

-- Margem por evento (receita, custo de equipe, custos diretos)
CREATE OR REPLACE VIEW vw_margem_evento AS
SELECT e.tenant_id, e.id AS evento_id, e.nome AS evento, e.status, e.cliente_id, c.nome_fantasia AS cliente, e.marca,
       e.praca_id, (SELECT min(inicio) FROM turno WHERE evento_id = e.id) AS inicio,
       COALESCE(fc.valor_total, (SELECT sum(p.quantidade * p.diaria_venda) FROM posto p JOIN turno t ON t.id = p.turno_id
                                  WHERE t.evento_id = e.id)) AS receita,
       COALESCE((SELECT sum(valor_total) FROM custo_alocacao WHERE evento_id = e.id),
                (SELECT sum(p.quantidade * p.diaria_custo) FROM posto p JOIN turno t ON t.id = p.turno_id
                  WHERE t.evento_id = e.id)) AS custo_equipe,
       COALESCE((SELECT sum(valor) FROM custo_direto WHERE evento_id = e.id), 0) AS custos_diretos,
       (e.status = 'fechado') AS realizado        -- false = margem prevista (pelos postos)
  FROM evento e
  JOIN cliente c ON c.id = e.cliente_id
  LEFT JOIN fatura_cliente fc ON fc.evento_id = e.id;
