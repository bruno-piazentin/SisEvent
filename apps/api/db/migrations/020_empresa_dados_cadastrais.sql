-- =====================================================================
-- 020 — Dados cadastrais da empresa (os mesmos do cadastro de clientes)
--
-- tenant.nome continua sendo o nome que aparece no sistema (nome fantasia);
-- os demais dados seguem as colunas e regras de cliente (010, 012, 015).
-- CNPJ e CPF são únicos na plataforma: a mesma empresa não entra duas vezes.
-- =====================================================================

ALTER TABLE tenant
  ADD COLUMN pessoa        text NOT NULL DEFAULT 'juridica' CHECK (pessoa IN ('juridica','fisica')),
  ADD COLUMN razao_social  text,
  ADD COLUMN cnpj          text CHECK (cnpj ~ '^\d{14}$'),
  ADD COLUMN cpf           text CHECK (cpf ~ '^\d{11}$'),
  ADD COLUMN telefone      text,
  ADD COLUMN email         citext,
  ADD COLUMN redes_sociais jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN cep           char(8) CHECK (cep ~ '^\d{8}$'),
  ADD COLUMN logradouro    text,
  ADD COLUMN numero        text,
  ADD COLUMN complemento   text,
  ADD COLUMN bairro        text,
  ADD COLUMN cidade        text,
  ADD COLUMN uf            char(2),
  ADD CONSTRAINT tenant_documento_pessoa CHECK ((pessoa = 'juridica' AND cpf IS NULL) OR (pessoa = 'fisica' AND cnpj IS NULL));

UPDATE tenant SET razao_social = nome WHERE razao_social IS NULL;

CREATE UNIQUE INDEX tenant_cnpj_key ON tenant (cnpj) WHERE cnpj IS NOT NULL;
CREATE UNIQUE INDEX tenant_cpf_key  ON tenant (cpf)  WHERE cpf IS NOT NULL;

-- Listagem do master: inclui documento e cidade para identificar a empresa
DROP FUNCTION listar_empresas();
CREATE FUNCTION listar_empresas()
RETURNS TABLE (id uuid, nome text, slug citext, ativo boolean, criado_em timestamptz,
               usuarios bigint, modulos text[],
               pessoa text, razao_social text, cnpj text, cpf text, cidade text, uf char(2))
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.nome, t.slug, t.ativo, t.criado_em,
         (SELECT count(*) FROM usuario u WHERE u.tenant_id = t.id AND u.ativo),
         ARRAY(SELECT ml.modulo FROM modulo_liberado ml
                 JOIN modulo m ON m.codigo = ml.modulo
                WHERE ml.tenant_id = t.id AND ml.ativo AND (ml.expira_em IS NULL OR ml.expira_em > now())
                ORDER BY m.ordem),
         t.pessoa, t.razao_social, t.cnpj, t.cpf, t.cidade, t.uf
    FROM tenant t
   ORDER BY t.nome
$$;
REVOKE ALL ON FUNCTION listar_empresas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION listar_empresas() TO app_api;
