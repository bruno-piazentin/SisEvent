-- =====================================================================
-- 007 — Auditoria completa desde o primeiro dia
-- Atende o "histórico de alterações de escala (quem, quando, por quê)" do M5
-- e é a matéria-prima do BI: sem histórico não se reconstrói o passado.
-- A API define app.usuario_id e, quando houver, app.motivo na transação.
-- =====================================================================

CREATE TABLE auditoria (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id    uuid,
  tabela       text NOT NULL,
  registro_id  uuid,
  operacao     char(1) NOT NULL CHECK (operacao IN ('I','U','D')),
  usuario_id   uuid,
  motivo       text,
  alterado     jsonb,              -- somente campos que mudaram (U) ou o registro inteiro (I/D)
  antes        jsonb,
  em           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_auditoria_registro ON auditoria (tabela, registro_id, em DESC);
CREATE INDEX ix_auditoria_tenant_em ON auditoria (tenant_id, em DESC);

CREATE OR REPLACE FUNCTION trg_auditar() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_new jsonb; v_old jsonb; v_diff jsonb; v_reg uuid;
BEGIN
  v_new := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;

  -- segredos e campos técnicos não vão para a auditoria
  v_new := v_new - ARRAY['senha_hash','totp_segredo','qr_segredo','token_hash','atualizado_em'];
  v_old := v_old - ARRAY['senha_hash','totp_segredo','qr_segredo','token_hash','atualizado_em'];

  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(n.key, n.value) INTO v_diff
      FROM jsonb_each(v_new) n
     WHERE v_old -> n.key IS DISTINCT FROM n.value;
    IF v_diff IS NULL THEN RETURN NEW; END IF;   -- nada mudou de fato
    v_old := (SELECT jsonb_object_agg(k, v_old -> k) FROM jsonb_object_keys(v_diff) k);
  ELSE
    v_diff := COALESCE(v_new, v_old);
    IF TG_OP = 'INSERT' THEN v_old := NULL; END IF;
  END IF;

  v_reg := COALESCE(v_new ->> 'id', v_old ->> 'id', v_new ->> 'alocacao_id', v_old ->> 'alocacao_id')::uuid;

  INSERT INTO auditoria (tenant_id, tabela, registro_id, operacao, usuario_id, motivo, alterado, antes)
  VALUES (COALESCE((v_new ->> 'tenant_id')::uuid, (to_jsonb(OLD) ->> 'tenant_id')::uuid),
          TG_TABLE_NAME, v_reg, left(TG_OP, 1), app_usuario(),
          NULLIF(current_setting('app.motivo', true), ''), v_diff,
          CASE WHEN TG_OP = 'UPDATE' THEN v_old WHEN TG_OP = 'DELETE' THEN v_old END);
  RETURN COALESCE(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuario','usuario_permissao','perfil_permissao','modulo_liberado',
                           'profissional','profissional_funcao','documento_profissional',
                           'cliente','oportunidade','proposta',
                           'evento','turno','posto','alocacao','apontamento','avaliacao','ocorrencia',
                           'lancamento_adicional','custo_direto','pagamento_profissional','fatura_cliente','regra_custo']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_auditoria AFTER INSERT OR UPDATE OR DELETE ON %I
                    FOR EACH ROW EXECUTE FUNCTION trg_auditar()', t);
  END LOOP;
END $$;

-- Histórico legível da escala de um evento
CREATE OR REPLACE VIEW vw_historico_escala AS
SELECT au.em, t.evento_id, au.operacao, au.motivo, u.nome AS usuario,
       pr.nome AS profissional, f.nome AS funcao, t.nome AS turno,
       au.antes ->> 'status' AS status_anterior,
       COALESCE(au.alterado ->> 'status', a.status::text) AS status_novo,
       au.alterado
  FROM auditoria au
  JOIN alocacao a ON a.id = au.registro_id
  JOIN posto p ON p.id = a.posto_id
  JOIN turno t ON t.id = p.turno_id
  JOIN funcao f ON f.id = p.funcao_id
  JOIN profissional pr ON pr.id = a.profissional_id
  LEFT JOIN usuario u ON u.id = au.usuario_id
 WHERE au.tabela = 'alocacao';
