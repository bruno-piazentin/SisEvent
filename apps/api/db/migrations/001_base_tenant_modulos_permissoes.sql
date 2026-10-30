-- =====================================================================
-- 001 — Base: extensões, empresa (tenant), usuários, módulos e permissões
-- Liberação por módulos em 3 camadas:
--   1) modulo_liberado     → o que a empresa contratou/ativou (faseamento)
--   2) perfil_permissao    → perfil × módulo × ação
--   3) usuario_permissao   → ajuste fino por usuário (concede ou bloqueia)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Contexto da requisição: a API define estes valores no início de cada transação
--   SET LOCAL app.tenant_id = '...'; SET LOCAL app.usuario_id = '...';
CREATE OR REPLACE FUNCTION app_tenant() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION app_usuario() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.usuario_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION set_atualizado_em() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END $$;

-- Empresa. Hoje: Rafa Dutra Eventos. Preparado para múltiplas empresas (SaaS).
CREATE TABLE tenant (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          text NOT NULL,
  slug          citext NOT NULL UNIQUE,
  fuso_horario  text NOT NULL DEFAULT 'America/Sao_Paulo',
  criado_em     timestamptz NOT NULL DEFAULT now()
);

-- Catálogo global de módulos (M1..M9 + BI)
CREATE TABLE modulo (
  codigo     text PRIMARY KEY,              -- 'M1', 'M2', ..., 'BI'
  nome       text NOT NULL,
  descricao  text,
  fase       smallint NOT NULL,             -- fase sugerida no escopo
  ordem      smallint NOT NULL
);

INSERT INTO modulo (codigo, nome, descricao, fase, ordem) VALUES
 ('M1','Banco de talentos','Cadastro detalhado de profissionais, documentos, avaliações e busca',1,1),
 ('M2','Captação e triagem','Formulário público, fila de triagem e funil',2,2),
 ('M3','Comercial','Clientes, briefings, propostas e pipeline',1,3),
 ('M4','Eventos e postos','Eventos, turnos, postos, requisitos e checklist',1,4),
 ('M5','Escala e alocação','Escala, convocação, suplentes, conflito de horário',1,5),
 ('M6','Check-in e campo','Check-in/out por link e QR, ocorrências e evidências',2,6),
 ('M7','Custo e financeiro','Cálculo de diárias, pagamentos, faturamento e margem',1,7),
 ('M8','Leads e relatórios','Captura de leads com LGPD e relatório pós-evento',2,8),
 ('M9','Painel de gestão','Painel, contas a receber, fornecedores',3,9),
 ('BI','Business intelligence','Camada analítica, indicadores e painéis',1,10);

-- Módulos ativos por empresa (o "contrato")
CREATE TABLE modulo_liberado (
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  modulo        text NOT NULL REFERENCES modulo(codigo),
  ativo         boolean NOT NULL DEFAULT true,
  liberado_em   timestamptz NOT NULL DEFAULT now(),
  expira_em     timestamptz,
  PRIMARY KEY (tenant_id, modulo)
);

CREATE TYPE acao_permissao AS ENUM ('ver','criar','editar','excluir','aprovar','ver_valores');

-- Perfis de acesso (Administradora, Central, Supervisor, Financeiro, Profissional)
CREATE TABLE perfil_acesso (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo      text NOT NULL,             -- 'admin','central','supervisor','financeiro'
  nome        text NOT NULL,
  acesso_total boolean NOT NULL DEFAULT false,
  UNIQUE (tenant_id, codigo)
);

CREATE TABLE perfil_permissao (
  perfil_id   uuid NOT NULL REFERENCES perfil_acesso(id) ON DELETE CASCADE,
  modulo      text NOT NULL REFERENCES modulo(codigo),
  acao        acao_permissao NOT NULL,
  PRIMARY KEY (perfil_id, modulo, acao)
);

CREATE TABLE usuario (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  perfil_id      uuid NOT NULL REFERENCES perfil_acesso(id),
  nome           text NOT NULL,
  email          citext NOT NULL,
  senha_hash     text,                    -- bcrypt, gerado pela API
  totp_segredo   text,                    -- 2FA opcional (obrigatório para ver valores, via política na API)
  ativo          boolean NOT NULL DEFAULT true,
  ultimo_acesso  timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);
CREATE TRIGGER trg_usuario_atualizado BEFORE UPDATE ON usuario
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

-- Ajuste fino por usuário: concede (true) ou bloqueia (false) algo que o perfil não dá / dá
CREATE TABLE usuario_permissao (
  usuario_id  uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  modulo      text NOT NULL REFERENCES modulo(codigo),
  acao        acao_permissao NOT NULL,
  concedido   boolean NOT NULL,
  PRIMARY KEY (usuario_id, modulo, acao)
);

-- Regra única de autorização, usada pela API e pelos painéis de BI.
-- 1) o módulo precisa estar liberado para a empresa (camada de contrato) — vale até para admin
-- 2) ajuste por usuário tem precedência
-- 3) senão vale o perfil (acesso_total ou permissão explícita)
CREATE OR REPLACE FUNCTION tem_permissao(p_usuario uuid, p_modulo text, p_acao acao_permissao)
RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH u AS (
    SELECT u.id, u.tenant_id, u.ativo, p.id AS perfil_id, p.acesso_total
      FROM usuario u JOIN perfil_acesso p ON p.id = u.perfil_id
     WHERE u.id = p_usuario
  ),
  liberado AS (
    SELECT EXISTS (
      SELECT 1 FROM modulo_liberado ml, u
       WHERE ml.tenant_id = u.tenant_id AND ml.modulo = p_modulo AND ml.ativo
         AND (ml.expira_em IS NULL OR ml.expira_em > now())
    ) AS ok
  ),
  ajuste AS (
    SELECT up.concedido FROM usuario_permissao up, u
     WHERE up.usuario_id = u.id AND up.modulo = p_modulo AND up.acao = p_acao
  )
  SELECT COALESCE((SELECT ativo FROM u), false)
     AND (SELECT ok FROM liberado)
     AND COALESCE(
           (SELECT concedido FROM ajuste),
           (SELECT acesso_total FROM u)
           OR EXISTS (SELECT 1 FROM perfil_permissao pp, u
                       WHERE pp.perfil_id = u.perfil_id AND pp.modulo = p_modulo AND pp.acao = p_acao)
         )
$$;

-- Menu do usuário: módulos que ele pode ao menos ver, com as ações liberadas
CREATE OR REPLACE VIEW vw_menu_usuario AS
SELECT u.id AS usuario_id, m.codigo AS modulo, m.nome, m.ordem,
       array_agg(a.acao ORDER BY a.acao) FILTER (WHERE tem_permissao(u.id, m.codigo, a.acao)) AS acoes
  FROM usuario u
  CROSS JOIN modulo m
  CROSS JOIN unnest(enum_range(NULL::acao_permissao)) AS a(acao)
 GROUP BY u.id, m.codigo, m.nome, m.ordem
HAVING bool_or(tem_permissao(u.id, m.codigo, 'ver'));

-- Cria os perfis padrão do escopo para uma empresa nova
CREATE OR REPLACE FUNCTION criar_perfis_padrao(p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_central uuid; v_sup uuid; v_fin uuid;
BEGIN
  INSERT INTO perfil_acesso (tenant_id, codigo, nome, acesso_total)
       VALUES (p_tenant,'admin','Administradora',true);

  INSERT INTO perfil_acesso (tenant_id, codigo, nome) VALUES (p_tenant,'central','Central / coordenação')
  RETURNING id INTO v_central;
  INSERT INTO perfil_acesso (tenant_id, codigo, nome) VALUES (p_tenant,'supervisor','Supervisor de campo')
  RETURNING id INTO v_sup;
  INSERT INTO perfil_acesso (tenant_id, codigo, nome) VALUES (p_tenant,'financeiro','Financeiro')
  RETURNING id INTO v_fin;

  -- Central: eventos, escalas, profissionais, ocorrências — SEM valores/margem
  INSERT INTO perfil_permissao (perfil_id, modulo, acao)
  SELECT v_central, m, a::acao_permissao
    FROM unnest(ARRAY['M1','M2','M3','M4','M5','M6','M8']) m,
         unnest(ARRAY['ver','criar','editar','aprovar']) a;
  INSERT INTO perfil_permissao VALUES (v_central,'M9','ver');

  -- Supervisor: apenas campo (o recorte "só o seu evento" é aplicado por evento_supervisor)
  INSERT INTO perfil_permissao (perfil_id, modulo, acao) VALUES
    (v_sup,'M4','ver'), (v_sup,'M5','ver'),
    (v_sup,'M6','ver'), (v_sup,'M6','criar'), (v_sup,'M6','editar'),
    (v_sup,'M8','ver'), (v_sup,'M8','criar');

  -- Financeiro: pagar/receber e valores, sem edição de escala
  INSERT INTO perfil_permissao (perfil_id, modulo, acao)
  SELECT v_fin, 'M7', a::acao_permissao FROM unnest(ARRAY['ver','criar','editar','aprovar','ver_valores']) a;
  INSERT INTO perfil_permissao (perfil_id, modulo, acao) VALUES
    (v_fin,'M4','ver'), (v_fin,'M5','ver'), (v_fin,'M3','ver'), (v_fin,'M3','ver_valores'),
    (v_fin,'M9','ver'), (v_fin,'M9','ver_valores'), (v_fin,'BI','ver'), (v_fin,'BI','ver_valores');
END $$;
