-- =====================================================================
-- 026 — Casting: inscrição pública de profissionais e fila de triagem (módulo M2, Captação)
-- Cada empresa divulga o próprio link (/casting/<código da empresa>). Quem se inscreve fica
-- nesta fila, fora do banco de talentos, até a equipe aprovar (vira profissional "em teste")
-- ou reprovar. O formulário não pede CPF, RG nem dados bancários: o DP coleta depois.
-- =====================================================================

CREATE TYPE status_inscricao AS ENUM ('pendente', 'aprovada', 'reprovada');

CREATE TABLE inscricao_casting (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT app_tenant() REFERENCES tenant(id) ON DELETE CASCADE,
  status            status_inscricao NOT NULL DEFAULT 'pendente',
  -- quem é
  nome              text NOT NULL CHECK (length(nome) BETWEEN 3 AND 120),
  nome_artistico    text CHECK (length(nome_artistico) <= 120),
  celular           text NOT NULL CHECK (celular ~ '^\+\d{12,13}$'),
  email             citext CHECK (length(email) <= 254),
  data_nascimento   date,
  genero            text CHECK (length(genero) <= 40),
  redes_sociais     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- onde mora
  cidade            text CHECK (length(cidade) <= 80),
  uf                char(2),
  bairro            text CHECK (length(bairro) <= 80),
  praca_base_id     uuid REFERENCES praca(id) ON DELETE SET NULL,
  -- perfil de casting
  funcoes           uuid[] NOT NULL DEFAULT '{}',
  altura_cm         smallint CHECK (altura_cm BETWEEN 100 AND 230),
  manequim          smallint CHECK (manequim BETWEEN 30 AND 70),
  tamanho_camiseta  tamanho_roupa,
  calcado           smallint CHECK (calcado BETWEEN 30 AND 50),
  tipo_cabelo       text,
  cor_cabelo        text,
  cor_olhos         text CHECK (length(cor_olhos) <= 40),
  tom_pele          text CHECK (length(tom_pele) <= 40),
  tatuagem_visivel  boolean,
  meios_locomocao   meio_locomocao[] NOT NULL DEFAULT '{}',
  idiomas           text[] NOT NULL DEFAULT '{}',
  experiencia       text CHECK (length(experiencia) <= 2000),
  -- controle
  consentimento_lgpd_em timestamptz NOT NULL,
  criado_em         timestamptz NOT NULL DEFAULT now(),
  analisada_por     uuid REFERENCES usuario(id),
  analisada_em      timestamptz,
  motivo_reprovacao text CHECK (length(motivo_reprovacao) <= 500),
  profissional_id   uuid REFERENCES profissional(id) ON DELETE SET NULL
);
CREATE INDEX inscricao_casting_fila_idx ON inscricao_casting (tenant_id, status, criado_em DESC);
-- uma inscrição pendente por celular: reenviar o formulário não duplica a fila
CREATE UNIQUE INDEX inscricao_casting_pendente_celular ON inscricao_casting (tenant_id, celular) WHERE status = 'pendente';

CREATE TABLE inscricao_casting_foto (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT app_tenant() REFERENCES tenant(id) ON DELETE CASCADE,
  inscricao_id  uuid NOT NULL REFERENCES inscricao_casting(id) ON DELETE CASCADE,
  nome_arquivo  text NOT NULL CHECK (length(nome_arquivo) <= 200),
  tipo_mime     text NOT NULL CHECK (tipo_mime IN ('image/jpeg','image/png','image/webp')),
  tamanho       integer NOT NULL CHECK (tamanho BETWEEN 1 AND 2097152),
  conteudo      bytea NOT NULL,
  ordem         smallint NOT NULL DEFAULT 0
);
CREATE INDEX inscricao_casting_foto_idx ON inscricao_casting_foto (inscricao_id, ordem);

ALTER TABLE inscricao_casting ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON inscricao_casting TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
ALTER TABLE inscricao_casting_foto ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON inscricao_casting_foto TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- referências presas à mesma empresa (ver 025)
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON inscricao_casting
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'praca_base_id:praca', 'profissional_id:profissional');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON inscricao_casting_foto
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'inscricao_id:inscricao_casting');

-- Empresa do link público: só empresas ativas e com o módulo de Captação liberado recebem inscrições.
-- Roda como dono porque a página pública não tem empresa no contexto (devolve só nome e logo).
CREATE FUNCTION casting_empresa(p_slug citext)
RETURNS TABLE (id uuid, nome text, logo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.nome, t.logo FROM tenant t
   WHERE t.slug = p_slug AND t.ativo
     AND EXISTS (SELECT 1 FROM modulo_liberado m WHERE m.tenant_id = t.id AND m.modulo = 'M2' AND m.ativo
                                                   AND (m.expira_em IS NULL OR m.expira_em > now()));
$$;
REVOKE ALL ON FUNCTION casting_empresa(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION casting_empresa(citext) TO app_api;
