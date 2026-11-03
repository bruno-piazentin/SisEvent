-- =====================================================================
-- 022 — Avaliação obrigatória, nas duas pontas
--
-- 1) A empresa avalia cada profissional que trabalhou (tabela avaliacao, 003):
--    o evento só fecha quando todos os que fizeram check-in tiverem nota.
-- 2) O profissional avalia o evento depois do check-out (avaliacao_evento).
-- Escala: 5 Excelente, 4 Muito bom, 3 Bom, 2 Regular, 1 Péssimo.
-- Nota 1 exige o relato do motivo; nas demais o comentário é opcional.
-- =====================================================================

-- nota 1 sem relato: só para as avaliações novas (NOT VALID preserva o histórico)
ALTER TABLE avaliacao ADD CONSTRAINT avaliacao_nota1_relato
  CHECK (nota > 1 OR length(btrim(coalesce(observacao, ''))) >= 10) NOT VALID;

CREATE TABLE avaliacao_evento (
  evento_id       uuid NOT NULL REFERENCES evento(id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  tenant_id       uuid NOT NULL DEFAULT app_tenant() REFERENCES tenant(id) ON DELETE CASCADE,
  nota            smallint NOT NULL CHECK (nota BETWEEN 1 AND 5),
  comentario      text CHECK (nota > 1 OR length(btrim(coalesce(comentario, ''))) >= 10),
  avaliado_em     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (evento_id, profissional_id)
);
ALTER TABLE avaliacao_evento ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON avaliacao_evento TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- Profissional avalia o evento pelo link pessoal (sem login): só eventos em que ele fez check-out
CREATE OR REPLACE FUNCTION avaliar_evento(p_token text, p_evento uuid, p_nota int, p_comentario text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prof uuid; v_tenant uuid;
BEGIN
  v_prof := autenticar_profissional(p_token);
  IF v_prof IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido', 'mensagem', 'Link inválido ou expirado.'); END IF;
  IF p_nota NOT BETWEEN 1 AND 5 THEN RETURN jsonb_build_object('ok', false, 'mensagem', 'Escolha uma nota de 1 a 5.'); END IF;
  IF p_nota = 1 AND length(btrim(coalesce(p_comentario, ''))) < 10 THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'Para a nota 1, conte o que aconteceu (pelo menos 10 letras).');
  END IF;
  SELECT e.tenant_id INTO v_tenant
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
    JOIN evento e ON e.id = t.evento_id JOIN apontamento ap ON ap.alocacao_id = a.id
   WHERE a.profissional_id = v_prof AND e.id = p_evento AND ap.checkout_em IS NOT NULL
   LIMIT 1;
  IF v_tenant IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'mensagem', 'A avaliação do evento abre depois do seu check-out.');
  END IF;
  INSERT INTO avaliacao_evento (evento_id, profissional_id, tenant_id, nota, comentario)
  VALUES (p_evento, v_prof, v_tenant, p_nota, nullif(btrim(p_comentario), ''))
  ON CONFLICT (evento_id, profissional_id) DO UPDATE
     SET nota = EXCLUDED.nota, comentario = EXCLUDED.comentario, avaliado_em = now();
  RETURN jsonb_build_object('ok', true, 'mensagem', 'Obrigado pela avaliação!');
END $$;
GRANT EXECUTE ON FUNCTION avaliar_evento(text, uuid, int, text) TO app_api;

-- Pendência nova: quem trabalhou (fez check-in) e ainda não foi avaliado
CREATE OR REPLACE FUNCTION pendencias_fechamento(p_evento uuid)
RETURNS TABLE (tipo text, descricao text, referencia uuid) LANGUAGE sql STABLE AS $$
  SELECT 'vaga_aberta', format('%s — %s: %s vaga(s) aberta(s) sem justificativa', q.turno, q.funcao, q.vagas_abertas), q.posto_id
    FROM vw_quadro_vagas q
   WHERE q.evento_id = p_evento AND q.vagas_abertas > 0 AND coalesce(trim(q.justificativa_vaga_aberta), '') = ''
  UNION ALL
  SELECT 'convite_sem_resposta', format('%s ainda não respondeu à convocação (%s)', pr.nome, t.nome), a.id
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
    JOIN profissional pr ON pr.id = a.profissional_id
   WHERE t.evento_id = p_evento AND a.status = 'convidado' AND a.tipo = 'titular'
  UNION ALL
  SELECT 'checkout_pendente', format('%s fez check-in sem check-out (%s)', pr.nome, t.nome), a.id
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
    JOIN profissional pr ON pr.id = a.profissional_id
    JOIN apontamento ap ON ap.alocacao_id = a.id
   WHERE t.evento_id = p_evento AND ap.checkin_em IS NOT NULL AND ap.checkout_em IS NULL
  UNION ALL
  SELECT 'avaliacao_pendente', format('%s trabalhou e ainda não foi avaliado(a) (%s)', pr.nome, t.nome), a.id
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
    JOIN profissional pr ON pr.id = a.profissional_id
    JOIN apontamento ap ON ap.alocacao_id = a.id
   WHERE t.evento_id = p_evento AND ap.checkin_em IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM avaliacao av WHERE av.alocacao_id = a.id)
$$;

-- fechar_evento (005): a avaliação pendente também bloqueia o fechamento
CREATE OR REPLACE FUNCTION fechar_evento(p_evento uuid, p_aceitar_checkout_pendente boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql AS $$
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
END $$;


-- Área do profissional: nota que ele deu a cada evento e as avaliações que ainda faltam
CREATE OR REPLACE FUNCTION area_profissional(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prof uuid;
BEGIN
  v_prof := autenticar_profissional(p_token);
  IF v_prof IS NULL THEN RETURN jsonb_build_object('ok', false, 'erro', 'link_invalido'); END IF;
  RETURN jsonb_build_object(
    'ok', true,
    'empresa', (SELECT jsonb_build_object('nome', t.nome, 'logo', t.logo)
                  FROM profissional pr JOIN tenant t ON t.id = pr.tenant_id WHERE pr.id = v_prof),
    'profissional', (SELECT jsonb_build_object('id', id, 'nome', COALESCE(nome_artistico, nome), 'foto_url', foto_url)
                       FROM profissional WHERE id = v_prof),
    'convocacoes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'alocacao_id', a.id, 'status', a.status, 'tipo', a.tipo,
               'evento_id', e.id, 'evento', e.nome, 'marca', e.marca, 'local', e.local_nome, 'endereco', e.endereco,
               'turno', t.nome, 'inicio', t.inicio, 'fim', t.fim, 'funcao', f.nome, 'uniforme', p.uniforme,
               'diaria', p.diaria_custo, 'exige_qr', e.exige_qr, 'exige_geolocalizacao', e.exige_geolocalizacao,
               'exige_selfie', e.exige_selfie,
               'checkin_em', ap.checkin_em, 'checkout_em', ap.checkout_em, 'presenca', ap.status,
               'nota_evento', (SELECT ae.nota FROM avaliacao_evento ae WHERE ae.evento_id = e.id AND ae.profissional_id = v_prof))
             ORDER BY t.inicio)
        FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
        JOIN evento e ON e.id = t.evento_id JOIN funcao f ON f.id = p.funcao_id
        LEFT JOIN apontamento ap ON ap.alocacao_id = a.id
       WHERE a.profissional_id = v_prof AND a.status IN ('convidado','confirmado')
         AND t.fim > now() - interval '12 hours' AND e.status NOT IN ('cancelado','fechado')), '[]'::jsonb),
    -- eventos em que ele já saiu (últimos 30 dias) e ainda não avaliou: a avaliação é obrigatória
    'avaliacoes_pendentes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('evento_id', x.id, 'evento', x.nome, 'saida', x.saida) ORDER BY x.saida DESC)
        FROM (SELECT e.id, e.nome, max(ap.checkout_em) AS saida
                FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
                JOIN evento e ON e.id = t.evento_id JOIN apontamento ap ON ap.alocacao_id = a.id
               WHERE a.profissional_id = v_prof AND ap.checkout_em > now() - interval '30 days'
                 AND NOT EXISTS (SELECT 1 FROM avaliacao_evento ae WHERE ae.evento_id = e.id AND ae.profissional_id = v_prof)
               GROUP BY e.id, e.nome) x), '[]'::jsonb),
    'pagamentos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('evento', e.nome, 'valor', pg.valor, 'status', pg.status, 'pago_em', pg.pago_em)
                       ORDER BY e.criado_em DESC)
        FROM pagamento_profissional pg JOIN evento e ON e.id = pg.evento_id
       WHERE pg.profissional_id = v_prof), '[]'::jsonb));
END $$;

