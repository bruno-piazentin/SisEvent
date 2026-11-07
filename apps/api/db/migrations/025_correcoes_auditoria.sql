-- =====================================================================
-- 025 — Correções da auditoria de segurança (novembro/2026)
--
-- 1) Views com security_invoker: a segurança por linha (RLS) passa a valer
--    também para quem lê pelas views (antes uma empresa via a margem das outras).
-- 2) Referências a registros de outra empresa (profissional, cliente, praça,
--    função, fornecedor, supervisor, responsável...) são recusadas pelo banco.
-- 3) Bloqueio por senha errada sem corrida: a tentativa é reservada antes de
--    conferir a senha (usuários e master).
-- 4) Auditoria das tabelas filhas (permissões, funções do profissional...) com
--    empresa e registro, visíveis para a administradora.
-- 5) Ponto: QR com hora do aparelho só até 1 h e marcado como suspeito; ponto
--    manual do supervisor dentro da janela do turno; substituição fecha o ponto
--    de quem saiu; links de profissional param quando a empresa é inativada.
-- 6) Fechamento: quem faltou entra com custo zero (antes o fechamento quebrava)
--    e pagamento pendente sem custo é cancelado ao fechar de novo.
-- 7) Limpeza do hash do master gravado nas empresas (o master entra só pela
--    rota própria, enquanto estiver configurado no ambiente).
-- =====================================================================

-- 1) views ------------------------------------------------------------------
ALTER VIEW vw_margem_evento        SET (security_invoker = true);
ALTER VIEW vw_historico_escala     SET (security_invoker = true);
ALTER VIEW vw_historico_profissional SET (security_invoker = true);
ALTER VIEW vw_menu_usuario         SET (security_invoker = true);
ALTER VIEW vw_quadro_vagas         SET (security_invoker = true);
ALTER VIEW vw_documentos_vencendo  SET (security_invoker = true);

-- 2) mesma empresa nas referências ---------------------------------------------
-- TG_ARGV[0]: 'tenant_id' (a própria linha) ou 'coluna:tabela' (empresa do registro referenciado)
-- TG_ARGV[1..]: 'coluna:tabela' que precisam ser da mesma empresa. Roda como dono para enxergar
-- a empresa do registro referenciado (a checagem de chave estrangeira do Postgres ignora o RLS).
CREATE FUNCTION trg_mesma_empresa() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_new jsonb := to_jsonb(NEW); v_base uuid; v_ref uuid; v_col text; v_tab text; v_id uuid; i int;
BEGIN
  IF TG_ARGV[0] = 'tenant_id' THEN
    v_base := (v_new ->> 'tenant_id')::uuid;
  ELSE
    v_col := split_part(TG_ARGV[0], ':', 1); v_tab := split_part(TG_ARGV[0], ':', 2);
    v_id := (v_new ->> v_col)::uuid;
    IF v_id IS NOT NULL THEN EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1', v_tab) INTO v_base USING v_id; END IF;
  END IF;
  IF v_base IS NULL THEN RETURN NEW; END IF;
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    v_col := split_part(TG_ARGV[i], ':', 1); v_tab := split_part(TG_ARGV[i], ':', 2);
    v_id := (v_new ->> v_col)::uuid;
    CONTINUE WHEN v_id IS NULL;
    v_ref := NULL;
    EXECUTE format('SELECT tenant_id FROM %I WHERE id = $1', v_tab) INTO v_ref USING v_id;
    IF v_ref IS NOT NULL AND v_ref <> v_base THEN
      RAISE EXCEPTION 'Registro relacionado não encontrado (%).', v_col USING ERRCODE = 'P0010';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION trg_mesma_empresa() FROM PUBLIC;

-- "zz" no nome: roda depois dos gatilhos que preenchem tenant_id (ex.: trg_alocacao_preparar)
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON alocacao
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'profissional_id:profissional', 'posto_id:posto');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON evento
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'cliente_id:cliente', 'praca_id:praca');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON turno
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'evento_id:evento');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON posto
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'turno_id:turno', 'funcao_id:funcao');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON custo_direto
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'evento_id:evento', 'fornecedor_id:fornecedor');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON lancamento_adicional
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'alocacao_id:alocacao');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON checklist_item
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'evento_id:evento', 'responsavel_id:usuario');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON evento_foto
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'evento_id:evento');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON ocorrencia
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'evento_id:evento', 'alocacao_id:alocacao');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON cliente
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'agencia_id:cliente');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON profissional
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('tenant_id', 'praca_base_id:praca');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON evento_supervisor
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('evento_id:evento', 'usuario_id:usuario');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON profissional_funcao
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('profissional_id:profissional', 'funcao_id:funcao');
CREATE TRIGGER trg_zz_mesma_empresa BEFORE INSERT OR UPDATE ON profissional_praca
  FOR EACH ROW EXECUTE FUNCTION trg_mesma_empresa('profissional_id:profissional', 'praca_id:praca');

-- 3) bloqueio por senha errada, reservado antes de conferir a senha ---------------
-- Cada tentativa conta como erro ANTES do bcrypt (com a linha travada). Assim tentativas simultâneas
-- não passam do limite: a 5ª reserva bloqueia e as seguintes são recusadas sem conferir a senha.
CREATE FUNCTION reservar_tentativa_login(p_usuario uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v usuario%ROWTYPE; n int;
BEGIN
  SELECT * INTO v FROM usuario WHERE id = p_usuario FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v.bloqueado_ate > now() THEN RETURN v.bloqueado_ate; END IF;
  n := CASE WHEN v.bloqueado_ate IS NOT NULL THEN 1 ELSE v.falhas_login + 1 END;   -- bloqueio vencido recomeça a contagem
  UPDATE usuario SET falhas_login = n,
         bloqueado_ate = CASE WHEN n >= 5 THEN now() + interval '15 minutes' END
   WHERE id = p_usuario;
  RETURN NULL;
END $$;

CREATE FUNCTION confirmar_login_ok(p_usuario uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE usuario SET falhas_login = 0, bloqueado_ate = NULL, ultimo_acesso = now() WHERE id = p_usuario;
$$;

CREATE FUNCTION reservar_tentativa_chave(p_chave text) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v bloqueio_login%ROWTYPE; n int;
BEGIN
  INSERT INTO bloqueio_login (chave) VALUES (p_chave) ON CONFLICT (chave) DO NOTHING;
  SELECT * INTO v FROM bloqueio_login WHERE chave = p_chave FOR UPDATE;
  IF v.bloqueado_ate > now() THEN RETURN v.bloqueado_ate; END IF;
  -- bloqueio vencido ou erros espaçados (mais de 15 minutos) recomeçam a contagem
  n := CASE WHEN v.bloqueado_ate IS NOT NULL OR v.ultima_falha < now() - interval '15 minutes' THEN 1 ELSE v.falhas + 1 END;
  UPDATE bloqueio_login SET falhas = n, ultima_falha = now(),
         bloqueado_ate = CASE WHEN n >= 5 THEN now() + interval '15 minutes' END
   WHERE chave = p_chave;
  RETURN NULL;
END $$;

CREATE FUNCTION confirmar_chave_ok(p_chave text) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM bloqueio_login WHERE chave = p_chave;
$$;

REVOKE ALL ON FUNCTION reservar_tentativa_login(uuid), confirmar_login_ok(uuid),
                       reservar_tentativa_chave(text), confirmar_chave_ok(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reservar_tentativa_login(uuid), confirmar_login_ok(uuid),
                          reservar_tentativa_chave(text), confirmar_chave_ok(text) TO app_api;
-- a API só mexe no bloqueio do master pelas funções acima
REVOKE ALL ON bloqueio_login FROM app_api;

-- 7) hash do master nas empresas --------------------------------------------------
-- A API chama na subida, com o e-mail e o hash do master configurados: as linhas que o
-- login do master criou nas empresas deixam de aceitar senha pela rota comum.
CREATE FUNCTION limpar_senha_master(p_email citext, p_hash text) RETURNS int
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  WITH x AS (UPDATE usuario SET senha_hash = NULL
              WHERE senha_hash IS NOT NULL AND (email = p_email OR senha_hash = p_hash) RETURNING 1)
  SELECT count(*)::int FROM x;
$$;
REVOKE ALL ON FUNCTION limpar_senha_master(citext, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION limpar_senha_master(citext, text) TO app_api;

-- 4), 5), 6) funções redefinidas -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_auditar()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE v_new jsonb; v_old jsonb; v_diff jsonb; v_reg uuid;
BEGIN
  v_new := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;

  -- segredos e campos técnicos não vão para a auditoria
  v_new := v_new - ARRAY['senha_hash','totp_segredo','qr_segredo','token_hash','atualizado_em','falhas_login'];
  v_old := v_old - ARRAY['senha_hash','totp_segredo','qr_segredo','token_hash','atualizado_em','falhas_login'];

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

  -- dados pessoais: fica registrado que mudou, nunca o valor
  v_diff := mascarar_sensiveis(v_diff);
  v_old  := mascarar_sensiveis(v_old);

  v_reg := COALESCE(v_new ->> 'id', v_old ->> 'id', v_new ->> 'alocacao_id', v_old ->> 'alocacao_id',
                   v_new ->> 'usuario_id', v_old ->> 'usuario_id', v_new ->> 'perfil_id', v_old ->> 'perfil_id',
                   v_new ->> 'profissional_id', v_old ->> 'profissional_id', v_new ->> 'oportunidade_id', v_old ->> 'oportunidade_id')::uuid;

  INSERT INTO auditoria (tenant_id, tabela, registro_id, operacao, usuario_id, motivo, alterado, antes)
  VALUES (COALESCE((v_new ->> 'tenant_id')::uuid, (to_jsonb(OLD) ->> 'tenant_id')::uuid, app_tenant()),
          TG_TABLE_NAME, v_reg, left(TG_OP, 1), app_usuario(),
          NULLIF(current_setting('app.motivo', true), ''), v_diff,
          CASE WHEN TG_OP = 'UPDATE' THEN v_old WHEN TG_OP = 'DELETE' THEN v_old END);
  RETURN COALESCE(NEW, OLD);
END $function$;

CREATE OR REPLACE FUNCTION public.calcular_custo_alocacao(p_alocacao uuid)
 RETURNS custo_alocacao
 LANGUAGE plpgsql
AS $function$
DECLARE
  r record; rc regra_custo%ROWTYPE; c custo_alocacao%ROWTYPE;
  v_horas_contr numeric; v_valor_hora numeric; v_ini timestamptz; v_fim timestamptz;
  v_min_trab int; v_min_extra int; v_desc numeric := 0;
BEGIN
  SELECT a.id, a.tenant_id, a.profissional_id, t.evento_id, t.inicio, t.fim, p.diaria_custo,
         COALESCE(ap.status, 'falta'::status_presenca) AS presenca,
         ap.checkin_em, ap.checkout_em, ap.atraso_min, ap.saida_antecipada_min,
         e.tolerancia_atraso_min, tn.fuso_horario
    INTO r
    FROM alocacao a
    JOIN posto p ON p.id = a.posto_id
    JOIN turno t ON t.id = p.turno_id
    JOIN evento e ON e.id = t.evento_id
    JOIN tenant tn ON tn.id = a.tenant_id
    LEFT JOIN apontamento ap ON ap.alocacao_id = a.id
   WHERE a.id = p_alocacao;

  SELECT * INTO rc FROM regra_custo WHERE tenant_id = r.tenant_id;
  IF NOT FOUND THEN rc := ROW(r.tenant_id, 50, 15, 20, '22:00', '05:00', false, false, 15)::regra_custo; END IF;

  v_horas_contr := extract(epoch FROM (r.fim - r.inicio)) / 3600.0;
  v_valor_hora  := r.diaria_custo / NULLIF(v_horas_contr, 0);

  c.alocacao_id := r.id; c.tenant_id := r.tenant_id; c.evento_id := r.evento_id;
  c.profissional_id := r.profissional_id; c.presenca := r.presenca;
  c.horas_contratadas := round(v_horas_contr, 2);
  c.calculado_em := now();
  -- quem não trabalhou entra com zero (as colunas são NOT NULL)
  c.horas_trabalhadas := 0; c.minutos_extra := 0; c.minutos_noturnos := 0;
  c.valor_diaria := 0; c.valor_extra := 0; c.valor_noturno := 0; c.valor_descontos := 0;

  IF r.presenca = 'presente' THEN
    -- período efetivo: do check-in (ou início do turno, se chegou antes) até o check-out (ou fim do turno)
    v_ini := GREATEST(r.checkin_em, r.inicio);
    v_fim := COALESCE(r.checkout_em, r.fim);
    v_min_trab := GREATEST(0, floor(extract(epoch FROM (v_fim - v_ini)) / 60));
    c.horas_trabalhadas := round(v_min_trab / 60.0, 2);

    -- hora extra: além do fim do turno, acima da tolerância, em blocos
    v_min_extra := GREATEST(0, floor(extract(epoch FROM (v_fim - r.fim)) / 60));
    IF v_min_extra <= rc.tolerancia_extra_min THEN v_min_extra := 0;
    ELSE v_min_extra := (v_min_extra / rc.arredondamento_min) * rc.arredondamento_min; END IF;
    c.minutos_extra := v_min_extra;

    c.valor_diaria := r.diaria_custo;
    c.valor_extra  := round(v_valor_hora * (v_min_extra / 60.0) * (1 + rc.hora_extra_pct / 100), 2);

    c.minutos_noturnos := minutos_noturnos(v_ini, v_fim, rc.noturno_inicio, rc.noturno_fim, r.fuso_horario);
    c.valor_noturno := round(v_valor_hora * (c.minutos_noturnos / 60.0) * (rc.adicional_noturno_pct / 100), 2);

    IF rc.desconta_atraso AND r.atraso_min > r.tolerancia_atraso_min THEN
      v_desc := v_desc - round(v_valor_hora * r.atraso_min / 60.0, 2);
    END IF;
    IF NOT rc.paga_saida_antecipada AND r.saida_antecipada_min > 0 THEN
      v_desc := v_desc - round(v_valor_hora * r.saida_antecipada_min / 60.0, 2);
    END IF;
    c.valor_descontos := GREATEST(v_desc, -r.diaria_custo);
  END IF;

  SELECT COALESCE(sum(valor), 0) INTO c.valor_adicionais
    FROM lancamento_adicional WHERE alocacao_id = r.id
     AND (r.presenca = 'presente' OR tipo = 'desconto');

  c.valor_total := GREATEST(0, c.valor_diaria + c.valor_extra + c.valor_noturno + c.valor_descontos + c.valor_adicionais);
  c.memoria_calculo := jsonb_build_object(
    'diaria', r.diaria_custo, 'valor_hora', round(v_valor_hora, 4),
    'checkin', r.checkin_em, 'checkout', r.checkout_em, 'turno', jsonb_build_object('inicio', r.inicio, 'fim', r.fim),
    'atraso_min', r.atraso_min, 'saida_antecipada_min', r.saida_antecipada_min,
    'regra', to_jsonb(rc) - 'tenant_id');

  INSERT INTO custo_alocacao VALUES (c.*)
  ON CONFLICT (alocacao_id) DO UPDATE SET
    presenca = EXCLUDED.presenca, horas_contratadas = EXCLUDED.horas_contratadas,
    horas_trabalhadas = EXCLUDED.horas_trabalhadas, minutos_extra = EXCLUDED.minutos_extra,
    minutos_noturnos = EXCLUDED.minutos_noturnos, valor_diaria = EXCLUDED.valor_diaria,
    valor_extra = EXCLUDED.valor_extra, valor_noturno = EXCLUDED.valor_noturno,
    valor_descontos = EXCLUDED.valor_descontos, valor_adicionais = EXCLUDED.valor_adicionais,
    valor_total = EXCLUDED.valor_total, memoria_calculo = EXCLUDED.memoria_calculo,
    calculado_em = EXCLUDED.calculado_em;
  RETURN c;
END $function$;

CREATE OR REPLACE FUNCTION public.fechar_evento(p_evento uuid, p_aceitar_checkout_pendente boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE e evento%ROWTYPE; v_pend int; v_aloc record; v_receita numeric; v_repasses numeric;
        v_custo_equipe numeric; v_custo_direto numeric; v_itens jsonb;
BEGIN
  SELECT * INTO e FROM evento WHERE id = p_evento FOR UPDATE;
  IF e.status = 'fechado' THEN RAISE EXCEPTION 'Evento já fechado' USING ERRCODE = 'P0002'; END IF;
  IF e.status IN ('cancelado','planejamento') THEN
    RAISE EXCEPTION 'Evento em status % não pode ser fechado', e.status USING ERRCODE = 'P0006';
  END IF;

  -- critério de aceite 1
  SELECT count(*) INTO v_pend FROM pendencias_fechamento(p_evento)
   WHERE tipo IN ('vaga_aberta','convite_sem_resposta','avaliacao_pendente')
      OR (tipo = 'checkout_pendente' AND NOT p_aceitar_checkout_pendente);
  IF v_pend > 0 THEN
    RAISE EXCEPTION 'Fechamento bloqueado: % pendência(s). Consulte pendencias_fechamento().', v_pend
      USING ERRCODE = 'P0007';
  END IF;

  -- confirmados sem apontamento viram falta
  INSERT INTO apontamento (tenant_id, alocacao_id, status, observacao)
  SELECT a.tenant_id, a.id, 'falta', 'falta registrada no fechamento (sem check-in)'
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
   WHERE t.evento_id = p_evento AND a.status = 'confirmado' AND a.tipo = 'titular'
  ON CONFLICT (alocacao_id) DO UPDATE SET status = 'falta'
   WHERE apontamento.status = 'previsto' AND apontamento.checkin_em IS NULL;

  -- custo por alocação (inclui substituídos que chegaram a trabalhar)
  FOR v_aloc IN
    SELECT a.id FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
     WHERE t.evento_id = p_evento AND a.tipo = 'titular' AND a.status IN ('confirmado','substituido')
  LOOP
    PERFORM calcular_custo_alocacao(v_aloc.id);
  END LOOP;

  -- valores a pagar por profissional (soma dos turnos)
  INSERT INTO pagamento_profissional (tenant_id, evento_id, profissional_id, valor, chave_pix)
  SELECT c.tenant_id, c.evento_id, c.profissional_id, sum(c.valor_total), pr.chave_pix
    FROM custo_alocacao c JOIN profissional pr ON pr.id = c.profissional_id
   WHERE c.evento_id = p_evento
   GROUP BY c.tenant_id, c.evento_id, c.profissional_id, pr.chave_pix
  HAVING sum(c.valor_total) > 0
  ON CONFLICT (evento_id, profissional_id) DO UPDATE SET valor = EXCLUDED.valor
   WHERE pagamento_profissional.status = 'pendente';

  -- re-fechamento: pendente que ficou sem custo (zerado por desconto, falta...) não pode continuar a pagar
  UPDATE pagamento_profissional pg SET valor = 0, status = 'cancelado'
   WHERE pg.evento_id = p_evento AND pg.status = 'pendente'
     AND COALESCE((SELECT sum(c.valor_total) FROM custo_alocacao c
                    WHERE c.evento_id = p_evento AND c.profissional_id = pg.profissional_id), 0) <= 0;

  -- faturamento ao cliente: pelo POSTO CONTRATADO (quantidade × diária de venda)
  SELECT COALESCE(sum(p.quantidade * p.diaria_venda), 0),
         COALESCE(jsonb_agg(jsonb_build_object('turno', t.nome, 'funcao', f.nome, 'quantidade', p.quantidade,
                                               'diaria', p.diaria_venda, 'subtotal', p.quantidade * p.diaria_venda)
                            ORDER BY t.inicio, f.nome), '[]')
    INTO v_receita, v_itens
    FROM posto p JOIN turno t ON t.id = p.turno_id JOIN funcao f ON f.id = p.funcao_id
   WHERE t.evento_id = p_evento;

  SELECT COALESCE((SELECT sum(valor) FROM custo_direto WHERE evento_id = p_evento AND repassa_cliente), 0)
       + COALESCE((SELECT sum(l.valor) FROM lancamento_adicional l JOIN custo_alocacao c ON c.alocacao_id = l.alocacao_id
                    WHERE c.evento_id = p_evento AND l.repassa_cliente), 0)
    INTO v_repasses;

  INSERT INTO fatura_cliente (tenant_id, evento_id, cliente_id, valor_postos, valor_repasses, valor_total, itens, vencimento)
  SELECT e.tenant_id, e.id, e.cliente_id, v_receita, v_repasses, v_receita + v_repasses, v_itens,
         current_date + c.prazo_pagamento_dias
    FROM cliente c WHERE c.id = e.cliente_id
  ON CONFLICT (evento_id) DO UPDATE SET valor_postos = EXCLUDED.valor_postos, valor_repasses = EXCLUDED.valor_repasses,
         valor_total = EXCLUDED.valor_total, itens = EXCLUDED.itens
   WHERE fatura_cliente.status = 'a_emitir';

  UPDATE evento SET status = 'fechado', fechado_em = now(), fechado_por = app_usuario() WHERE id = p_evento;

  SELECT COALESCE(sum(valor_total), 0) INTO v_custo_equipe FROM custo_alocacao WHERE evento_id = p_evento;
  SELECT COALESCE(sum(valor), 0) INTO v_custo_direto FROM custo_direto WHERE evento_id = p_evento;

  RETURN jsonb_build_object(
    'evento_id', p_evento,
    'receita', v_receita + v_repasses,
    'custo_equipe', v_custo_equipe,
    'custos_diretos', v_custo_direto,
    'margem', v_receita + v_repasses - v_custo_equipe - v_custo_direto,
    'margem_pct', round(100 * (v_receita + v_repasses - v_custo_equipe - v_custo_direto) / NULLIF(v_receita + v_repasses, 0), 2),
    'pagamentos', (SELECT jsonb_agg(jsonb_build_object('profissional', pr.nome, 'valor', pg.valor) ORDER BY pr.nome)
                     FROM pagamento_profissional pg JOIN profissional pr ON pr.id = pg.profissional_id
                    WHERE pg.evento_id = p_evento));
END $function$;

CREATE OR REPLACE FUNCTION public.substituir_em_campo(p_alocacao uuid, p_substituto uuid, p_motivo text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE v_posto uuid; v_nova uuid; v_tenant uuid; v_fim timestamptz; v_saida timestamptz;
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Substituição exige motivo' USING ERRCODE = 'P0004';
  END IF;
  UPDATE alocacao SET status = 'substituido', motivo = p_motivo
   WHERE id = p_alocacao AND status = 'confirmado'
  RETURNING posto_id, tenant_id INTO v_posto, v_tenant;
  IF v_posto IS NULL THEN RAISE EXCEPTION 'Alocação não confirmada' USING ERRCODE = 'P0005'; END IF;
  SELECT t.fim INTO v_fim FROM posto p JOIN turno t ON t.id = p.turno_id WHERE p.id = v_posto;
  v_saida := LEAST(now(), v_fim);

  INSERT INTO apontamento (tenant_id, alocacao_id, status, observacao)
  VALUES (v_tenant, p_alocacao, 'falta', 'Substituído: ' || p_motivo)
  ON CONFLICT (alocacao_id) DO UPDATE SET
    status = CASE WHEN apontamento.checkin_em IS NULL THEN 'falta'::status_presenca ELSE apontamento.status END,
    -- quem já tinha entrado sai na hora da substituição
    checkout_em = CASE WHEN apontamento.checkin_em IS NOT NULL AND apontamento.checkout_em IS NULL
                       THEN GREATEST(apontamento.checkin_em + interval '1 minute', v_saida) ELSE apontamento.checkout_em END,
    checkout_metodo = CASE WHEN apontamento.checkin_em IS NOT NULL AND apontamento.checkout_em IS NULL
                           THEN 'supervisor' ELSE apontamento.checkout_metodo END,
    saida_antecipada_min = CASE WHEN apontamento.checkin_em IS NOT NULL AND apontamento.checkout_em IS NULL
                                THEN GREATEST(0, floor(extract(epoch FROM (v_fim - GREATEST(apontamento.checkin_em + interval '1 minute', v_saida))) / 60)::int)
                                ELSE apontamento.saida_antecipada_min END;

  -- se o substituto já era suplente do posto, promove; senão cria
  UPDATE alocacao SET tipo = 'titular', status = 'confirmado', substitui_id = p_alocacao, motivo = 'substituição em campo'
   WHERE posto_id = v_posto AND profissional_id = p_substituto
  RETURNING id INTO v_nova;
  IF v_nova IS NULL THEN
    INSERT INTO alocacao (tenant_id, posto_id, profissional_id, tipo, status, substitui_id, motivo, criado_por, respondido_em)
    VALUES (v_tenant, v_posto, p_substituto, 'titular', 'confirmado', p_alocacao, 'substituição em campo', app_usuario(), now())
    RETURNING id INTO v_nova;
  END IF;

  INSERT INTO ocorrencia (tenant_id, evento_id, alocacao_id, tipo, descricao, registrado_por)
  SELECT v_tenant, t.evento_id, p_alocacao, 'substituicao', p_motivo, app_usuario()
    FROM posto p JOIN turno t ON t.id = p.turno_id WHERE p.id = v_posto;
  RETURN v_nova;
END $function$;

CREATE OR REPLACE FUNCTION public.registrar_ponto_supervisor(p_alocacao uuid, p_tipo text, p_momento timestamp with time zone, p_observacao text)
 RETURNS apontamento
 LANGUAGE plpgsql
AS $function$
DECLARE v_apt apontamento%ROWTYPE; v_inicio timestamptz; v_fim timestamptz; v_tenant uuid; v_antec int;
BEGIN
  IF p_observacao IS NULL OR length(trim(p_observacao)) < 5 THEN
    RAISE EXCEPTION 'Lançamento manual exige observação' USING ERRCODE = 'P0004';
  END IF;
  SELECT t.inicio, t.fim, a.tenant_id, e.checkin_antecedencia_min INTO v_inicio, v_fim, v_tenant, v_antec
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id JOIN evento e ON e.id = t.evento_id
   WHERE a.id = p_alocacao AND a.status = 'confirmado';
  IF NOT FOUND THEN RAISE EXCEPTION 'Alocação não confirmada' USING ERRCODE = 'P0005'; END IF;

  -- mesma janela do ponto do profissional e nunca no futuro: o horário vira hora extra no fechamento
  IF p_tipo IN ('checkin','checkout') THEN
    IF p_momento > now() + interval '5 minutes' THEN
      RAISE EXCEPTION 'O horário informado está no futuro.' USING ERRCODE = 'P0009';
    END IF;
    IF p_momento < v_inicio - make_interval(mins => COALESCE(v_antec, 0)) OR p_momento > v_fim + interval '4 hours' THEN
      RAISE EXCEPTION 'Horário fora da janela do turno (até % min antes do início e até 4 h depois do fim).', COALESCE(v_antec, 0)
        USING ERRCODE = 'P0009';
    END IF;
  END IF;

  INSERT INTO apontamento (tenant_id, alocacao_id) VALUES (v_tenant, p_alocacao) ON CONFLICT (alocacao_id) DO NOTHING;
  SELECT * INTO v_apt FROM apontamento WHERE alocacao_id = p_alocacao FOR UPDATE;
  IF p_tipo = 'checkout' AND (v_apt.checkin_em IS NULL OR p_momento <= v_apt.checkin_em) THEN
    RAISE EXCEPTION 'A saída precisa de uma entrada registrada antes dela.' USING ERRCODE = 'P0009';
  END IF;

  IF p_tipo = 'checkin' THEN
    UPDATE apontamento SET status = 'presente', checkin_em = p_momento, checkin_metodo = 'supervisor',
           atraso_min = GREATEST(0, floor(extract(epoch FROM (p_momento - v_inicio)) / 60)::int),
           registrado_por = app_usuario(), observacao = concat_ws('; ', observacao, p_observacao)
     WHERE alocacao_id = p_alocacao RETURNING * INTO v_apt;
  ELSIF p_tipo = 'checkout' THEN
    UPDATE apontamento SET checkout_em = p_momento, checkout_metodo = 'supervisor',
           saida_antecipada_min = GREATEST(0, floor(extract(epoch FROM (v_fim - p_momento)) / 60)::int),
           registrado_por = app_usuario(), observacao = concat_ws('; ', observacao, p_observacao)
     WHERE alocacao_id = p_alocacao RETURNING * INTO v_apt;
  ELSIF p_tipo IN ('falta','falta_justificada') THEN
    UPDATE apontamento SET status = p_tipo::status_presenca, checkin_em = NULL, checkout_em = NULL,
           registrado_por = app_usuario(), observacao = concat_ws('; ', observacao, p_observacao)
     WHERE alocacao_id = p_alocacao RETURNING * INTO v_apt;
  ELSE
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = '22023';
  END IF;
  RETURN v_apt;
END $function$;

CREATE OR REPLACE FUNCTION public.registrar_ponto(p_token text, p_evento uuid, p_tipo text, p_codigo_qr text DEFAULT NULL::text, p_dispositivo_em timestamp with time zone DEFAULT NULL::timestamp with time zone, p_lat numeric DEFAULT NULL::numeric, p_lng numeric DEFAULT NULL::numeric, p_selfie_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_prof uuid; e evento%ROWTYPE; v_aloc record; v_apt apontamento%ROWTYPE;
  v_agora timestamptz := now(); v_metodo text; v_suspeito boolean := false; v_obs text[] := '{}';
  v_dist double precision; v_offline boolean := false; v_momento timestamptz;
BEGIN
  IF p_tipo NOT IN ('checkin','checkout') THEN
    RAISE EXCEPTION 'Tipo inválido: %', p_tipo USING ERRCODE = '22023';
  END IF;

  v_prof := autenticar_profissional(p_token);
  IF v_prof IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido',
      'mensagem', 'Seu link expirou. Peça um novo código para a coordenação.');
  END IF;

  SELECT * INTO e FROM evento WHERE id = p_evento;
  IF NOT FOUND OR e.status IN ('cancelado','fechado') THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'evento_indisponivel', 'mensagem', 'Evento não disponível para check-in.');
  END IF;

  -- Hora do aparelho: só é considerada para sincronização offline (passado, até 1 h). Esse ponto fica
  -- marcado como suspeito: com a hora escolhida pelo celular, um QR antigo voltaria a valer.
  IF p_dispositivo_em IS NOT NULL THEN
    IF p_dispositivo_em > v_agora + interval '5 minutes' THEN
      v_suspeito := true; v_obs := v_obs || 'relógio do celular adiantado'::text;
    ELSIF p_dispositivo_em < v_agora - interval '2 minutes' AND p_dispositivo_em > v_agora - interval '1 hour' THEN
      v_offline := true; v_suspeito := true; v_obs := v_obs || format('sincronizado offline (%s min depois)',
                                   floor(extract(epoch FROM (v_agora - p_dispositivo_em)) / 60));
    END IF;
  END IF;
  v_momento := CASE WHEN v_offline THEN p_dispositivo_em ELSE v_agora END;

  -- QR
  IF e.exige_qr THEN
    IF p_codigo_qr IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'qr_obrigatorio', 'mensagem', 'Escaneie o QR code com o supervisor.');
    ELSIF NOT qr_valido(p_evento, p_codigo_qr, v_momento) THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'qr_expirado', 'mensagem', 'QR code expirado. Escaneie novamente.');
    END IF;
    v_metodo := 'qr';
  ELSE
    v_metodo := CASE WHEN p_codigo_qr IS NOT NULL AND qr_valido(p_evento, p_codigo_qr, v_momento) THEN 'qr' ELSE 'link' END;
    -- sem QR não há prova de presença no horário do aparelho: offline sem QR é sinalizado
    IF v_offline AND v_metodo = 'link' THEN v_suspeito := true; END IF;
  END IF;

  -- Geolocalização (opcional por evento)
  IF e.exige_geolocalizacao THEN
    IF p_lat IS NULL OR p_lng IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'geo_obrigatoria', 'mensagem', 'Permita a localização para registrar o ponto.');
    END IF;
    IF e.latitude IS NOT NULL THEN
      v_dist := distancia_m(p_lat, p_lng, e.latitude, e.longitude);
      IF v_dist > e.raio_geo_m THEN
        v_suspeito := true; v_obs := v_obs || format('fora do raio: %s m', round(v_dist));
      END IF;
    END IF;
  END IF;

  IF e.exige_selfie AND p_tipo = 'checkin' AND p_selfie_url IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'selfie_obrigatoria', 'mensagem', 'Tire uma selfie para confirmar o check-in.');
  END IF;

  -- Alocação confirmada deste profissional neste evento, cuja janela de ponto está aberta agora
  SELECT a.id, a.status, t.inicio, t.fim, t.nome AS turno, f.nome AS funcao
    INTO v_aloc
    FROM alocacao a
    JOIN posto p ON p.id = a.posto_id
    JOIN turno t ON t.id = p.turno_id
    JOIN funcao f ON f.id = p.funcao_id
   WHERE a.profissional_id = v_prof AND t.evento_id = p_evento
     AND a.status = 'confirmado' AND a.tipo = 'titular'
     AND v_momento BETWEEN t.inicio - make_interval(mins => e.checkin_antecedencia_min) AND t.fim + interval '4 hours'
   ORDER BY abs(extract(epoch FROM (t.inicio - v_momento)))
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erro', 'sem_escala',
      'mensagem', 'Não encontramos escala confirmada sua neste evento agora. Fale com o supervisor.');
  END IF;

  INSERT INTO apontamento (tenant_id, alocacao_id) VALUES (e.tenant_id, v_aloc.id)
  ON CONFLICT (alocacao_id) DO NOTHING;
  SELECT * INTO v_apt FROM apontamento WHERE alocacao_id = v_aloc.id FOR UPDATE;

  IF p_tipo = 'checkin' THEN
    IF v_apt.checkin_em IS NOT NULL THEN   -- idempotente: reenvio offline não duplica
      RETURN jsonb_build_object('ok', true, 'repetido', true, 'tipo', 'checkin', 'em', v_apt.checkin_em,
                                'turno', v_aloc.turno, 'mensagem', 'Check-in já estava registrado.');
    END IF;
    UPDATE apontamento SET
      status = 'presente',
      -- se veio da fila offline, vale a hora em que o QR foi lido no aparelho
      checkin_em = v_momento,
      checkin_dispositivo_em = p_dispositivo_em, checkin_metodo = v_metodo,
      checkin_lat = p_lat, checkin_lng = p_lng, checkin_selfie_url = p_selfie_url,
      suspeito = suspeito OR v_suspeito,
      observacao = NULLIF(concat_ws('; ', observacao, array_to_string(v_obs, '; ')), '')
    WHERE id = v_apt.id RETURNING * INTO v_apt;

    UPDATE apontamento SET atraso_min = GREATEST(0,
        floor(extract(epoch FROM (checkin_em - v_aloc.inicio)) / 60)::int)
     WHERE id = v_apt.id RETURNING * INTO v_apt;

    RETURN jsonb_build_object('ok', true, 'tipo', 'checkin', 'em', v_apt.checkin_em, 'turno', v_aloc.turno,
      'funcao', v_aloc.funcao, 'atraso_min', v_apt.atraso_min,
      'atrasado', v_apt.atraso_min > e.tolerancia_atraso_min,
      'mensagem', CASE WHEN v_apt.atraso_min > e.tolerancia_atraso_min
                       THEN format('Check-in registrado com %s min de atraso.', v_apt.atraso_min)
                       ELSE 'Check-in registrado. Bom trabalho!' END);
  ELSE
    IF v_apt.checkin_em IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'erro', 'sem_checkin', 'mensagem', 'Faça o check-in antes do check-out.');
    END IF;
    IF v_apt.checkout_em IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'repetido', true, 'tipo', 'checkout', 'em', v_apt.checkout_em,
                                'mensagem', 'Check-out já estava registrado.');
    END IF;
    UPDATE apontamento SET
      checkout_em = GREATEST(checkin_em + interval '1 minute', v_momento),
      checkout_dispositivo_em = p_dispositivo_em, checkout_metodo = v_metodo,
      suspeito = suspeito OR v_suspeito,
      observacao = NULLIF(concat_ws('; ', observacao, array_to_string(v_obs, '; ')), '')
    WHERE id = v_apt.id RETURNING * INTO v_apt;

    UPDATE apontamento SET saida_antecipada_min = GREATEST(0,
        floor(extract(epoch FROM (v_aloc.fim - checkout_em)) / 60)::int)
     WHERE id = v_apt.id RETURNING * INTO v_apt;

    RETURN jsonb_build_object('ok', true, 'tipo', 'checkout', 'em', v_apt.checkout_em,
      'horas', round(extract(epoch FROM (v_apt.checkout_em - v_apt.checkin_em)) / 3600.0, 2),
      'saida_antecipada_min', v_apt.saida_antecipada_min,
      'mensagem', 'Check-out registrado. Obrigado!');
  END IF;
END $function$;

CREATE OR REPLACE FUNCTION public.autenticar_profissional(p_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_prof uuid;
BEGIN
  UPDATE acesso_profissional a SET ultimo_uso_em = now()
    FROM profissional p JOIN tenant t ON t.id = p.tenant_id
   WHERE a.token_hash = digest(p_token, 'sha256')
     AND a.revogado_em IS NULL AND a.expira_em > now()
     AND p.id = a.profissional_id AND p.status <> 'bloqueado' AND t.ativo
  RETURNING a.profissional_id INTO v_prof;
  RETURN v_prof;
END $function$;

-- ---------------------------------------------------------------------------
-- Cliente excluído (excluido_em) não recebe evento, contato, ocorrência, oportunidade
-- nem fatura nova. Vale para todos os caminhos (API, clonar_evento, fechar_evento).
-- Recuperar o cliente libera de novo.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_cliente_nao_excluido() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $function$
BEGIN
  IF NEW.cliente_id IS NULL THEN RETURN NEW; END IF;
  -- em evento e oportunidade a edição de outros campos continua livre; só a troca de cliente confere
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('evento', 'oportunidade') AND NEW.cliente_id IS NOT DISTINCT FROM OLD.cliente_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM cliente WHERE id = NEW.cliente_id AND excluido_em IS NOT NULL) THEN
    RAISE EXCEPTION 'Cliente excluído: recupere o cadastro antes de lançar algo para ele.' USING ERRCODE = 'P0010';
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_cliente_nao_excluido ON evento;
CREATE TRIGGER trg_cliente_nao_excluido BEFORE INSERT OR UPDATE OF cliente_id ON evento
  FOR EACH ROW EXECUTE FUNCTION trg_cliente_nao_excluido();
DROP TRIGGER IF EXISTS trg_cliente_nao_excluido ON oportunidade;
CREATE TRIGGER trg_cliente_nao_excluido BEFORE INSERT OR UPDATE OF cliente_id ON oportunidade
  FOR EACH ROW EXECUTE FUNCTION trg_cliente_nao_excluido();
DROP TRIGGER IF EXISTS trg_cliente_nao_excluido ON cliente_contato;
CREATE TRIGGER trg_cliente_nao_excluido BEFORE INSERT OR UPDATE ON cliente_contato
  FOR EACH ROW EXECUTE FUNCTION trg_cliente_nao_excluido();
DROP TRIGGER IF EXISTS trg_cliente_nao_excluido ON ocorrencia_cadastro;
CREATE TRIGGER trg_cliente_nao_excluido BEFORE INSERT OR UPDATE ON ocorrencia_cadastro
  FOR EACH ROW EXECUTE FUNCTION trg_cliente_nao_excluido();
DROP TRIGGER IF EXISTS trg_cliente_nao_excluido ON fatura_cliente;
CREATE TRIGGER trg_cliente_nao_excluido BEFORE INSERT ON fatura_cliente
  FOR EACH ROW EXECUTE FUNCTION trg_cliente_nao_excluido();
