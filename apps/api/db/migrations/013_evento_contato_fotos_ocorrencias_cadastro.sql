-- =====================================================================
-- 013 — Contato e fotos do local do evento; ocorrências dos cadastros
--
-- * evento: contato do local (nome, telefone, e-mail). latitude/longitude
--   continuam no banco (saíram só da tela): sem elas o check-in com
--   localização registra onde a pessoa estava, mas não mede a distância.
-- * evento_foto: fotos do local enviadas pela equipe ou pelo cliente.
--   Ficam no próprio banco (bytea) — já chegam reduzidas pelo navegador.
-- * ocorrencia_cadastro: anotações em texto livre na ficha do cliente ou
--   do profissional (não confundir com "ocorrencia", que é de campo/evento)
-- =====================================================================

ALTER TABLE evento
  ADD COLUMN contato_local_nome     text,
  ADD COLUMN contato_local_telefone text,
  ADD COLUMN contato_local_email    citext;

CREATE TABLE evento_foto (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL DEFAULT app_tenant() REFERENCES tenant(id) ON DELETE CASCADE,
  evento_id    uuid NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  nome_arquivo text NOT NULL,
  tipo_mime    text NOT NULL CHECK (tipo_mime IN ('image/jpeg','image/png','image/webp')),
  tamanho      integer NOT NULL CHECK (tamanho BETWEEN 1 AND 5242880),   -- até 5 MB
  conteudo     bytea NOT NULL,
  legenda      text,
  enviado_por  uuid REFERENCES usuario(id) DEFAULT app_usuario(),
  enviado_em   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evento_foto_evento_idx ON evento_foto (evento_id, enviado_em);

CREATE TABLE ocorrencia_cadastro (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_tenant() REFERENCES tenant(id) ON DELETE CASCADE,
  cliente_id      uuid REFERENCES cliente(id) ON DELETE CASCADE,
  profissional_id uuid REFERENCES profissional(id) ON DELETE CASCADE,
  texto           text NOT NULL CHECK (length(trim(texto)) >= 3),
  registrado_por  uuid REFERENCES usuario(id) DEFAULT app_usuario(),
  registrado_em   timestamptz NOT NULL DEFAULT now(),
  CHECK ((cliente_id IS NULL) <> (profissional_id IS NULL))   -- de um cadastro só
);
CREATE INDEX ocorrencia_cadastro_cliente_idx ON ocorrencia_cadastro (cliente_id, registrado_em DESC) WHERE cliente_id IS NOT NULL;
CREATE INDEX ocorrencia_cadastro_prof_idx ON ocorrencia_cadastro (profissional_id, registrado_em DESC) WHERE profissional_id IS NOT NULL;

ALTER TABLE evento_foto ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON evento_foto TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE ocorrencia_cadastro ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON ocorrencia_cadastro TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- histórico registrado é só inclusão: ninguém edita nem apaga uma ocorrência
REVOKE UPDATE, DELETE ON ocorrencia_cadastro FROM app_api;
