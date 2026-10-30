-- =====================================================================
-- 018 — Cadastro de empresas pela plataforma (usuário master)
--
-- Cada empresa continua no mesmo banco, isolada pelo RLS (009): a API só
-- enxerga as linhas do tenant da requisição. Criar a empresa, os perfis e o
-- primeiro admin acontece DENTRO do contexto da nova empresa, então também
-- passa pelo RLS. A única leitura entre empresas é a listagem abaixo.
-- =====================================================================

ALTER TABLE tenant ADD COLUMN ativo boolean NOT NULL DEFAULT true;

-- Empresa inativa: ninguém dela entra (o master continua entrando, para manutenção)
CREATE OR REPLACE FUNCTION buscar_usuario_login(p_email citext, p_tenant_slug citext)
RETURNS TABLE (id uuid, tenant_id uuid, nome text, senha_hash text, ativo boolean, perfil text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.nome, u.senha_hash, u.ativo AND t.ativo, p.codigo
    FROM usuario u JOIN tenant t ON t.id = u.tenant_id JOIN perfil_acesso p ON p.id = u.perfil_id
   WHERE u.email = p_email AND t.slug = p_tenant_slug
$$;

-- Resumo de todas as empresas para a tela da plataforma. Só nome, situação e contagens:
-- nenhum dado operacional (clientes, eventos, valores) sai daqui.
CREATE OR REPLACE FUNCTION listar_empresas()
RETURNS TABLE (id uuid, nome text, slug citext, ativo boolean, criado_em timestamptz,
               usuarios bigint, modulos text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.nome, t.slug, t.ativo, t.criado_em,
         (SELECT count(*) FROM usuario u WHERE u.tenant_id = t.id AND u.ativo),
         ARRAY(SELECT ml.modulo FROM modulo_liberado ml
                 JOIN modulo m ON m.codigo = ml.modulo
                WHERE ml.tenant_id = t.id AND ml.ativo AND (ml.expira_em IS NULL OR ml.expira_em > now())
                ORDER BY m.ordem)
    FROM tenant t
   ORDER BY t.nome
$$;

GRANT EXECUTE ON FUNCTION listar_empresas() TO app_api;
