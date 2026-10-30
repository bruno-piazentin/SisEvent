-- =====================================================================
-- 011 — Marcas que o cliente representa / vende
--
-- * "marca" deixa de ser um tipo de cliente: clientes antigos com
--   tipo = 'marca' passam para 'outro'.
-- * marca: catálogo de marcas da empresa (cresce conforme os clientes
--   são cadastrados). nome_busca (minúsculo e sem acento) evita
--   duplicar "Coca-Cola" / "coca cola " e permite a busca por marca.
-- * cliente_marca: quais marcas cada cliente representa (N:N)
-- =====================================================================

UPDATE cliente SET tipo = 'outro' WHERE tipo = 'marca';
ALTER TABLE cliente DROP CONSTRAINT IF EXISTS cliente_tipo_check;
ALTER TABLE cliente ALTER COLUMN tipo SET DEFAULT 'outro';
ALTER TABLE cliente ADD CONSTRAINT cliente_tipo_check CHECK (tipo IN ('agencia','produtora','outro'));

-- unaccent() não é IMMUTABLE; o trigger calcula a chave de busca
CREATE OR REPLACE FUNCTION normalizar_busca(p text) RETURNS text
LANGUAGE sql STABLE AS $$ SELECT lower(regexp_replace(unaccent(trim(p)), '[^[:alnum:]]+', ' ', 'g')) $$;

CREATE TABLE marca (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT app_tenant() REFERENCES tenant(id) ON DELETE CASCADE,
  nome       text NOT NULL CHECK (length(trim(nome)) >= 1),
  nome_busca text NOT NULL,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome_busca)
);
CREATE INDEX marca_busca_trgm_idx ON marca USING gin (nome_busca gin_trgm_ops);

CREATE OR REPLACE FUNCTION trg_marca_normalizar() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.nome := regexp_replace(trim(NEW.nome), '\s+', ' ', 'g');
  NEW.nome_busca := trim(normalizar_busca(NEW.nome));
  RETURN NEW;
END $$;
CREATE TRIGGER trg_marca_normalizar BEFORE INSERT OR UPDATE OF nome ON marca
  FOR EACH ROW EXECUTE FUNCTION trg_marca_normalizar();

CREATE TABLE cliente_marca (
  cliente_id uuid NOT NULL REFERENCES cliente(id) ON DELETE CASCADE,
  marca_id   uuid NOT NULL REFERENCES marca(id) ON DELETE CASCADE,
  PRIMARY KEY (cliente_id, marca_id)
);
CREATE INDEX cliente_marca_marca_idx ON cliente_marca (marca_id);

ALTER TABLE marca ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON marca TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE cliente_marca ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON cliente_marca TO app_api
  USING (EXISTS (SELECT 1 FROM cliente c WHERE c.id = cliente_id));
