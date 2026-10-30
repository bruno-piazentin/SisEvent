-- =====================================================================
-- 009 — Isolamento por empresa (Row-Level Security) e papel da API
--
-- A API conecta com um usuário membro de "app_api" (sem BYPASSRLS) e, em
-- cada transação, executa SET LOCAL app.tenant_id / app.usuario_id.
-- Mesmo com bug na API, uma empresa nunca lê dados de outra.
-- As funções chamadas pelo profissional (link sem login) rodam como
-- SECURITY DEFINER: elas mesmas resolvem a empresa a partir do token.
-- =====================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_api') THEN
    CREATE ROLE app_api NOLOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO app_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_api;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_api;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_api;
-- A API pode disparar a atualização do BI e ler indicadores
GRANT USAGE ON SCHEMA analytics TO app_api;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO app_api;
GRANT EXECUTE ON FUNCTION analytics.atualizar(boolean) TO app_api;
-- Auditoria é só de inserção (via trigger) e leitura: ninguém apaga histórico
REVOKE UPDATE, DELETE ON auditoria FROM app_api;
-- Catálogo de módulos é global e só muda por migração
REVOKE INSERT, UPDATE, DELETE ON modulo FROM app_api;

-- tenant_id preenchido automaticamente pelo contexto da requisição
DO $$
DECLARE t text;
BEGIN
  FOR t IN
    SELECT c.table_name FROM information_schema.columns c
      JOIN information_schema.tables tb ON tb.table_name = c.table_name AND tb.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND tb.table_type = 'BASE TABLE'
       AND c.table_name NOT IN ('auditoria')
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET DEFAULT app_tenant()', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY isolamento_tenant ON %I TO app_api
                      USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
  END LOOP;
END $$;

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON tenant TO app_api USING (id = app_tenant());

ALTER TABLE auditoria ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON auditoria TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id IS NULL OR tenant_id = app_tenant());

-- Tabelas-filhas sem tenant_id: protegidas pelo pai
ALTER TABLE perfil_permissao ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON perfil_permissao TO app_api
  USING (EXISTS (SELECT 1 FROM perfil_acesso p WHERE p.id = perfil_id));
ALTER TABLE usuario_permissao ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON usuario_permissao TO app_api
  USING (EXISTS (SELECT 1 FROM usuario u WHERE u.id = usuario_id));
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profissional_funcao','profissional_praca','disponibilidade_semanal',
                           'indisponibilidade','documento_profissional','codigo_otp'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY isolamento_tenant ON %I TO app_api
                      USING (EXISTS (SELECT 1 FROM profissional p WHERE p.id = profissional_id))', t);
  END LOOP;
END $$;
ALTER TABLE cliente_contato ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON cliente_contato TO app_api
  USING (EXISTS (SELECT 1 FROM cliente c WHERE c.id = cliente_id));
ALTER TABLE proposta ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON proposta TO app_api
  USING (EXISTS (SELECT 1 FROM oportunidade o WHERE o.id = oportunidade_id));
ALTER TABLE evento_supervisor ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON evento_supervisor TO app_api
  USING (EXISTS (SELECT 1 FROM evento e WHERE e.id = evento_id));
ALTER TABLE avaliacao ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON avaliacao TO app_api
  USING (EXISTS (SELECT 1 FROM alocacao a WHERE a.id = alocacao_id));

-- Login: a API precisa achar o usuário pelo e-mail ANTES de saber a empresa
CREATE OR REPLACE FUNCTION buscar_usuario_login(p_email citext, p_tenant_slug citext)
RETURNS TABLE (id uuid, tenant_id uuid, nome text, senha_hash text, ativo boolean, perfil text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.nome, u.senha_hash, u.ativo, p.codigo
    FROM usuario u JOIN tenant t ON t.id = u.tenant_id JOIN perfil_acesso p ON p.id = u.perfil_id
   WHERE u.email = p_email AND t.slug = p_tenant_slug
$$;

-- Funções da área do profissional: resolvem a empresa pelo token
ALTER FUNCTION autenticar_profissional(text) SECURITY DEFINER SET search_path = public;
ALTER FUNCTION registrar_ponto(text, uuid, text, text, timestamptz, numeric, numeric, text) SECURITY DEFINER SET search_path = public;

-- Painel do profissional: convocações e histórico (somente dele)
CREATE OR REPLACE FUNCTION area_profissional(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prof uuid;
BEGIN
  v_prof := autenticar_profissional(p_token);
  IF v_prof IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido'); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'profissional', (SELECT jsonb_build_object('id', id, 'nome', COALESCE(nome_artistico, nome), 'foto_url', foto_url)
                       FROM profissional WHERE id = v_prof),
    'convocacoes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'alocacao_id', a.id, 'status', a.status, 'tipo', a.tipo,
               'evento_id', e.id, 'evento', e.nome, 'marca', e.marca, 'local', e.local_nome, 'endereco', e.endereco,
               'turno', t.nome, 'inicio', t.inicio, 'fim', t.fim, 'funcao', f.nome, 'uniforme', p.uniforme,
               'diaria', p.diaria_custo, 'exige_qr', e.exige_qr, 'exige_geolocalizacao', e.exige_geolocalizacao,
               'exige_selfie', e.exige_selfie,
               'checkin_em', ap.checkin_em, 'checkout_em', ap.checkout_em, 'presenca', ap.status)
             ORDER BY t.inicio)
        FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
        JOIN evento e ON e.id = t.evento_id JOIN funcao f ON f.id = p.funcao_id
        LEFT JOIN apontamento ap ON ap.alocacao_id = a.id
       WHERE a.profissional_id = v_prof AND a.status IN ('convidado','confirmado')
         AND t.fim > now() - interval '12 hours' AND e.status NOT IN ('cancelado','fechado')), '[]'::jsonb),
    'pagamentos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('evento', e.nome, 'valor', pg.valor, 'status', pg.status, 'pago_em', pg.pago_em)
                       ORDER BY e.criado_em DESC)
        FROM pagamento_profissional pg JOIN evento e ON e.id = pg.evento_id
       WHERE pg.profissional_id = v_prof), '[]'::jsonb));
END $$;

-- Aceite/recusa da convocação pelo próprio profissional
CREATE OR REPLACE FUNCTION responder_convocacao(p_token text, p_alocacao uuid, p_aceita boolean, p_motivo text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prof uuid; v_status status_alocacao;
BEGIN
  v_prof := autenticar_profissional(p_token);
  IF v_prof IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido'); END IF;
  PERFORM set_config('app.motivo', COALESCE(p_motivo, CASE WHEN p_aceita THEN 'aceite pelo profissional' ELSE 'recusa pelo profissional' END), true);
  UPDATE alocacao SET status = CASE WHEN p_aceita THEN 'confirmado'::status_alocacao ELSE 'recusado'::status_alocacao END,
         respondido_em = now(), motivo = COALESCE(p_motivo, motivo)
   WHERE id = p_alocacao AND profissional_id = v_prof AND status = 'convidado'
  RETURNING status INTO v_status;
  IF v_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'convocacao_indisponivel', 'mensagem', 'Esta convocação já foi respondida ou cancelada.');
  END IF;
  RETURN jsonb_build_object('ok', true, 'status', v_status);
END $$;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO app_api;

-- Atualização do BI chamada pela API: REFRESH exige ser dono das materialized views
ALTER FUNCTION analytics.atualizar(boolean) SECURITY DEFINER SET search_path = public, analytics;
GRANT EXECUTE ON FUNCTION analytics.atualizar(boolean) TO app_api;

-- Tabelas e funções criadas por migrações futuras já nascem acessíveis à API
-- (lembrete: toda tabela nova com tenant_id precisa de ENABLE RLS + política isolamento_tenant)
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_api;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO app_api;
