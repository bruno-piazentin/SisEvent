-- =====================================================================
-- 016 — Fotos do profissional (book de casting)
-- Mesmo padrão de evento_foto: reduzidas no navegador e guardadas no
-- banco. Uma delas pode ser a principal (a primeira enviada já é).
-- =====================================================================

CREATE TABLE profissional_foto (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL DEFAULT app_tenant() REFERENCES tenant(id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  nome_arquivo    text NOT NULL,
  tipo_mime       text NOT NULL CHECK (tipo_mime IN ('image/jpeg','image/png','image/webp')),
  tamanho         integer NOT NULL CHECK (tamanho BETWEEN 1 AND 5242880),
  conteudo        bytea NOT NULL,
  legenda         text,
  principal       boolean NOT NULL DEFAULT false,
  enviado_por     uuid REFERENCES usuario(id) DEFAULT app_usuario(),
  enviado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profissional_foto_prof_idx ON profissional_foto (profissional_id, enviado_em);
CREATE UNIQUE INDEX profissional_foto_uma_principal ON profissional_foto (profissional_id) WHERE principal;

ALTER TABLE profissional_foto ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON profissional_foto TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
