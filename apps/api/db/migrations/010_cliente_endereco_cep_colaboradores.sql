-- =====================================================================
-- 010 — Cadastro detalhado do cliente, tabela de CEP e colaboradores
--
-- * cliente ganha telefone, e-mail da empresa e endereço completo
-- * cep: cache global dos endereços consultados na base dos Correios
--   (via ViaCEP / BrasilAPI). Não tem tenant_id: CEP é dado público.
-- * cliente_contato passa a ser o cadastro de colaboradores (agentes)
--   da empresa cliente: nome, sobrenome, apelido, cargo, e-mail, telefone
-- =====================================================================

CREATE TABLE cep (
  cep           char(8) PRIMARY KEY CHECK (cep ~ '^\d{8}$'),
  logradouro    text,
  complemento   text,
  bairro        text,
  cidade        text NOT NULL,
  uf            char(2) NOT NULL,
  ibge          text,
  fonte         text NOT NULL,                  -- viacep | brasilapi
  consultado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cep_cidade_idx ON cep (uf, cidade);

ALTER TABLE cliente
  ADD COLUMN telefone    text,
  ADD COLUMN email       citext,
  ADD COLUMN cep         char(8) CHECK (cep ~ '^\d{8}$'),
  ADD COLUMN logradouro  text,
  ADD COLUMN numero      text,
  ADD COLUMN complemento text,
  ADD COLUMN bairro      text,
  ADD COLUMN cidade      text,
  ADD COLUMN uf          char(2);

ALTER TABLE cliente_contato
  ADD COLUMN sobrenome text,
  ADD COLUMN apelido   text,
  ADD COLUMN ativo     boolean NOT NULL DEFAULT true,
  ADD COLUMN criado_em timestamptz NOT NULL DEFAULT now();
CREATE INDEX cliente_contato_cliente_idx ON cliente_contato (cliente_id);
