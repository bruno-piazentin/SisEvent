-- =====================================================================
-- 028 — Exportação dos dados entregue só ao titular
-- A cópia dos dados (acesso e portabilidade) traz CPF, RG e chave Pix. Para ninguém se passar pelo
-- profissional e receber o arquivo, a administradora não baixa mais a cópia: o sistema gera um link
-- de uso pessoal, válido por 72 horas, que só pode ser enviado ao celular que já está no cadastro.
-- =====================================================================

CREATE TABLE exportacao_titular (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT app_tenant() REFERENCES tenant(id) ON DELETE CASCADE,
  profissional_id  uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  token_hash       bytea NOT NULL UNIQUE,             -- o link em si nunca é guardado
  criado_por       uuid REFERENCES usuario(id),
  criado_em        timestamptz NOT NULL DEFAULT now(),
  expira_em        timestamptz NOT NULL,
  baixado_em       timestamptz,                      -- primeira vez que o titular baixou
  downloads        integer NOT NULL DEFAULT 0
);
CREATE INDEX exportacao_titular_prof_idx ON exportacao_titular (tenant_id, profissional_id, criado_em DESC);
ALTER TABLE exportacao_titular ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON exportacao_titular TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON exportacao_titular
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'profissional_id:profissional');

-- Gera o link (roda com o RLS da empresa do contexto). Um link novo invalida os anteriores da pessoa.
CREATE FUNCTION gerar_exportacao_titular(p_profissional uuid) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v_token text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profissional WHERE id = p_profissional AND celular ~ '^\+\d{12,13}$') THEN
    RAISE EXCEPTION 'Profissional sem celular válido no cadastro' USING ERRCODE = 'P0003';
  END IF;
  UPDATE exportacao_titular SET expira_em = now() WHERE profissional_id = p_profissional AND expira_em > now();
  v_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  INSERT INTO exportacao_titular (profissional_id, token_hash, criado_por, expira_em)
  VALUES (p_profissional, digest(v_token, 'sha256'), app_usuario(), now() + interval '72 hours');
  RETURN v_token;
END $$;

-- Página pública do titular: descobre empresa e profissional pelo link e conta o download.
-- Roda como dono porque não há empresa no contexto; devolve só os dois ids de um link válido.
CREATE FUNCTION exportacao_por_token(p_token text)
RETURNS TABLE (tenant_id uuid, profissional_id uuid)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE exportacao_titular e SET downloads = e.downloads + 1, baixado_em = COALESCE(e.baixado_em, now())
   WHERE e.token_hash = digest(p_token, 'sha256') AND e.expira_em > now()
  RETURNING e.tenant_id, e.profissional_id;
$$;
REVOKE ALL ON FUNCTION exportacao_por_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION exportacao_por_token(text) TO app_api;
