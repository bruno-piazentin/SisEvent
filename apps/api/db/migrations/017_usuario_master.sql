-- =====================================================================
-- 017 — Usuário master de manutenção
--
-- O master (MASTER_EMAIL / MASTER_SENHA_HASH na API) entra em qualquer empresa.
-- No login a API precisa do id da empresa antes de ter o contexto dela; com o id
-- em mãos, cria ou atualiza o usuário admin dentro do RLS normal da empresa.
-- Esta função só devolve o id: não expõe nenhum outro dado da empresa.
-- =====================================================================

CREATE OR REPLACE FUNCTION tenant_por_slug(p_slug citext) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM tenant WHERE slug = p_slug
$$;

GRANT EXECUTE ON FUNCTION tenant_por_slug(citext) TO app_api;
