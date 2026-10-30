-- =====================================================================
-- 012 — Cliente: novos tipos, pessoa física (CPF), status e exclusão lógica
--
-- * tipos: + indústria, representante, revenda, supermercado
-- * pessoa 'juridica' (CNPJ) ou 'fisica' (CPF); razao_social guarda o
--   nome completo da pessoa física
-- * ativo (já existia) = status Ativo / Inativo
-- * excluído: o cliente some das telas mas continua na base, com quem
--   excluiu e quando; pode ser recuperado pelo CNPJ ou CPF
-- =====================================================================

ALTER TABLE cliente DROP CONSTRAINT IF EXISTS cliente_tipo_check;
ALTER TABLE cliente ADD CONSTRAINT cliente_tipo_check
  CHECK (tipo IN ('agencia','produtora','industria','representante','revenda','supermercado','outro'));

ALTER TABLE cliente
  ADD COLUMN pessoa       text NOT NULL DEFAULT 'juridica' CHECK (pessoa IN ('juridica','fisica')),
  ADD COLUMN cpf          text CHECK (cpf ~ '^\d{11}$'),
  ADD COLUMN excluido_em  timestamptz,
  ADD COLUMN excluido_por uuid REFERENCES usuario(id),
  ADD COLUMN status_alterado_em timestamptz;

-- CNPJ só para pessoa jurídica, CPF só para pessoa física.
-- A unicidade vale também para os excluídos: é por ela que a exclusão é recuperada.
ALTER TABLE cliente ADD CONSTRAINT cliente_documento_pessoa
  CHECK ((pessoa = 'juridica' AND cpf IS NULL) OR (pessoa = 'fisica' AND cnpj IS NULL));
ALTER TABLE cliente ADD CONSTRAINT cliente_tenant_id_cpf_key UNIQUE (tenant_id, cpf);

CREATE INDEX cliente_visiveis_idx ON cliente (tenant_id) WHERE excluido_em IS NULL;
