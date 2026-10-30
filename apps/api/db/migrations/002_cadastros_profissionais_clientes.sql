-- =====================================================================
-- 002 — M1 Banco de talentos e M3 Clientes
-- Ficha detalhada: medidas, disponibilidade por dia/horário, meios de
-- locomoção, regiões de atuação, documentos com validade e avaliações.
-- =====================================================================

-- unaccent() não é IMMUTABLE; esta função permite índice de busca sem acento
CREATE OR REPLACE FUNCTION busca_normalizada(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, coalesce(t,''))) $$;

-- Praça = cidade/região de operação (Londrina, Maringá, ...)
CREATE TABLE praca (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  nome       text NOT NULL,
  uf         char(2) NOT NULL,
  UNIQUE (tenant_id, nome, uf)
);

-- Perfis de trabalho (catálogo por empresa, editável)
CREATE TABLE funcao (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  codigo     text NOT NULL,
  nome       text NOT NULL,
  UNIQUE (tenant_id, codigo)
);

CREATE TYPE status_profissional AS ENUM ('em_teste','ativo','inativo','bloqueado');
CREATE TYPE origem_cadastro     AS ENUM ('interno','formulario_publico','importacao');
CREATE TYPE meio_locomocao      AS ENUM ('carro_proprio','moto_propria','transporte_publico','aplicativo','bicicleta','a_pe','carona');
CREATE TYPE tamanho_roupa       AS ENUM ('PP','P','M','G','GG','XG','XGG');

CREATE TABLE profissional (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  -- dados pessoais
  nome               text NOT NULL,
  nome_artistico     text,
  cpf                text,                 -- armazenar só dígitos; criptografia em repouso via storage do provedor + mascaramento na API
  rg                 text,
  data_nascimento    date,
  genero             text,
  foto_url           text,
  -- contato
  celular            text NOT NULL,        -- E.164: +5543999990000 — canal do link de acesso
  email              citext,
  instagram          text,
  -- endereço / base
  cidade             text,
  uf                 char(2),
  bairro             text,
  cep                text,
  praca_base_id      uuid REFERENCES praca(id),
  raio_km            smallint,             -- quanto aceita se deslocar a partir da base
  -- medidas e aparência (casting)
  altura_cm          smallint CHECK (altura_cm BETWEEN 100 AND 230),
  peso_kg            numeric(5,1),
  manequim           smallint,             -- numeração de roupa (36, 38, 40...)
  tamanho_camiseta   tamanho_roupa,
  calcado            smallint,
  busto_cm           smallint,
  cintura_cm         smallint,
  quadril_cm         smallint,
  cor_cabelo         text,
  cor_olhos          text,
  tom_pele           text,
  tatuagem_visivel   boolean,
  -- locomoção e habilitação
  meios_locomocao    meio_locomocao[] NOT NULL DEFAULT '{}',
  cnh_categoria      text,                 -- 'A','B','AB', ...
  cnh_validade       date,
  -- outras infos operacionais
  idiomas            text[] NOT NULL DEFAULT '{}',
  restricoes_alimentares text,
  experiencia        text,
  observacoes_internas text,               -- não visível para o profissional
  -- dados bancários (M7)
  chave_pix          text,
  tipo_chave_pix     text,
  banco              text,
  agencia            text,
  conta              text,
  forma_contratacao  text,                 -- 'autonomo','mei','clt' — premissa em aberto no escopo
  cnpj_mei           text,
  -- controle
  status             status_profissional NOT NULL DEFAULT 'em_teste',
  origem             origem_cadastro NOT NULL DEFAULT 'interno',
  consentimento_lgpd_em timestamptz,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, celular),
  UNIQUE (tenant_id, cpf)
);
CREATE TRIGGER trg_profissional_atualizado BEFORE UPDATE ON profissional
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();
CREATE INDEX ix_profissional_busca ON profissional USING gin (busca_normalizada(nome) gin_trgm_ops);

-- Funções que a pessoa exerce (promotor, recepcionista, hostess...)
CREATE TABLE profissional_funcao (
  profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  funcao_id       uuid NOT NULL REFERENCES funcao(id),
  nivel           smallint NOT NULL DEFAULT 1 CHECK (nivel BETWEEN 1 AND 3), -- 1 iniciante, 2 experiente, 3 líder
  PRIMARY KEY (profissional_id, funcao_id)
);

-- Praças onde aceita trabalhar (além da base)
CREATE TABLE profissional_praca (
  profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  praca_id        uuid NOT NULL REFERENCES praca(id),
  PRIMARY KEY (profissional_id, praca_id)
);

-- Disponibilidade recorrente: dia da semana (0=domingo .. 6=sábado) e faixa de horário.
-- Faixa que vira a madrugada (ex.: 22:00 → 04:00) é registrada com hora_fim < hora_inicio.
CREATE TABLE disponibilidade_semanal (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  dia_semana      smallint NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio     time NOT NULL,
  hora_fim        time NOT NULL,
  CHECK (hora_inicio <> hora_fim)
);
CREATE INDEX ix_disp_prof ON disponibilidade_semanal (profissional_id, dia_semana);

-- Bloqueios pontuais (viagem, prova, outro trabalho)
CREATE TABLE indisponibilidade (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  periodo         tstzrange NOT NULL,
  motivo          text
);
CREATE INDEX ix_indisp ON indisponibilidade USING gist (profissional_id, periodo);

-- Documentos com validade (alerta de vencimento)
CREATE TABLE documento_profissional (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  tipo            text NOT NULL,          -- 'rg','cnh','comprovante_residencia','atestado','manipulacao_alimentos','nr35'...
  arquivo_url     text NOT NULL,
  validade        date,
  verificado_por  uuid REFERENCES usuario(id),
  verificado_em   timestamptz,
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_doc_validade ON documento_profissional (validade) WHERE validade IS NOT NULL;

CREATE OR REPLACE VIEW vw_documentos_vencendo AS
SELECT p.tenant_id, d.*, p.nome AS profissional_nome, (d.validade - current_date) AS dias_restantes
  FROM documento_profissional d JOIN profissional p ON p.id = d.profissional_id
 WHERE d.validade IS NOT NULL AND d.validade <= current_date + 30;

-- =====================================================================
-- M3 — Clientes
-- =====================================================================
CREATE TABLE cliente (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  razao_social  text NOT NULL,
  nome_fantasia text,
  cnpj          text,
  tipo          text NOT NULL DEFAULT 'marca' CHECK (tipo IN ('marca','agencia','produtora','outro')),
  agencia_id    uuid REFERENCES cliente(id),   -- quando a marca chega via agência
  cor_primaria  text,                          -- identidade visual no relatório PDF (M8)
  logo_url      text,
  prazo_pagamento_dias smallint NOT NULL DEFAULT 30,
  ativo         boolean NOT NULL DEFAULT true,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cnpj)
);
CREATE TRIGGER trg_cliente_atualizado BEFORE UPDATE ON cliente
  FOR EACH ROW EXECUTE FUNCTION set_atualizado_em();

CREATE TABLE cliente_contato (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  uuid NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  nome        text NOT NULL,
  cargo       text,
  email       citext,
  telefone    text,
  principal   boolean NOT NULL DEFAULT false
);

CREATE TYPE etapa_pipeline AS ENUM ('lead','briefing','proposta','aprovado','executado','faturado','perdido');

CREATE TABLE oportunidade (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  cliente_id     uuid NOT NULL REFERENCES cliente(id),
  titulo         text NOT NULL,
  etapa          etapa_pipeline NOT NULL DEFAULT 'lead',
  canal_origem   text,                   -- whatsapp, email, indicação... (rastreio de quem pediu e por onde)
  solicitante    text,
  solicitado_em  timestamptz NOT NULL DEFAULT now(),
  briefing       jsonb NOT NULL DEFAULT '{}'::jsonb, -- objetivo, local, datas, perfil, uniforme, metas, materiais
  responsavel_id uuid REFERENCES usuario(id),
  criado_em      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE proposta (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oportunidade_id uuid NOT NULL REFERENCES oportunidade(id) ON DELETE CASCADE,
  versao          smallint NOT NULL,
  itens           jsonb NOT NULL,        -- [{funcao, qtd, turnos, diaria_custo, diaria_venda}]
  custos_diretos  numeric(12,2) NOT NULL DEFAULT 0,
  margem_pct      numeric(5,2),
  valor_total     numeric(12,2) NOT NULL,
  status          text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho','enviada','aprovada','recusada')),
  criado_em       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oportunidade_id, versao)
);
