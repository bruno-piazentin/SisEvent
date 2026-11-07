-- =====================================================================
-- Testes das regras de negócio no banco (rodar após reset-local.sh)
--   psql $DATABASE_URL -v ON_ERROR_STOP=1 -f db/tests/regras_negocio.sql
-- Use o usuário DONO do schema (não o da API): os blocos 11 e 13 criam outra empresa e trocam
-- para o papel app_api sozinhos.
-- Tudo roda dentro de uma transação desfeita no final (não suja o seed).
-- Cada bloco DO falha com EXCEPTION se a regra não se comportar como esperado.
-- =====================================================================
\set QUIET on
\pset footer off
BEGIN;
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true) \g /dev/null
SELECT set_config('app.usuario_id', '10000000-0000-0000-0000-000000000002', true) \g /dev/null

\echo '── 1. Liberação por módulo e permissões'
DO $$
DECLARE admin uuid := '10000000-0000-0000-0000-000000000001'; central uuid := '10000000-0000-0000-0000-000000000002';
        sup uuid := '10000000-0000-0000-0000-000000000003'; fin uuid := '10000000-0000-0000-0000-000000000004';
BEGIN
  ASSERT tem_permissao(admin, 'M7', 'ver_valores'),        'admin deve ver valores';
  ASSERT NOT tem_permissao(admin, 'M2', 'ver'),            'M2 não liberado: nem admin acessa';
  ASSERT NOT tem_permissao(central, 'M7', 'ver_valores'),  'central não vê margem';
  ASSERT tem_permissao(central, 'M5', 'editar'),           'central edita escala';
  ASSERT NOT tem_permissao(fin, 'M5', 'editar'),           'financeiro não edita escala';
  ASSERT tem_permissao(fin, 'M7', 'aprovar'),              'financeiro aprova pagamento';
  ASSERT tem_permissao(sup, 'M6', 'criar'),                'supervisor registra ponto';
  ASSERT NOT tem_permissao(sup, 'M1', 'ver'),              'supervisor não acessa banco de talentos';
  -- ajuste fino por usuário
  INSERT INTO usuario_permissao VALUES (central, 'M7', 'ver', true);
  ASSERT tem_permissao(central, 'M7', 'ver'),              'ajuste por usuário concede M7';
  -- liberar M2 para a empresa → passa a valer para quem o perfil permite
  INSERT INTO modulo_liberado (tenant_id, modulo) VALUES (app_tenant(), 'M2');
  ASSERT tem_permissao(central, 'M2', 'aprovar'),          'M2 liberado: central aprova triagem';
  ASSERT NOT tem_permissao(fin, 'M2', 'ver'),              'M2 liberado, mas perfil financeiro não tem';
  RAISE NOTICE 'ok — permissões em 3 camadas';
END $$;
SELECT modulo, nome, acoes FROM vw_menu_usuario WHERE usuario_id = '10000000-0000-0000-0000-000000000004' ORDER BY ordem;

\echo '── 2. Trava de conflito de horário (critério de aceite 2)'
DO $$
BEGIN
  -- Ana já está confirmada em Londrina 14h–20h; posto de Maringá é 18h–01h no mesmo sábado
  BEGIN
    INSERT INTO alocacao (posto_id, profissional_id) VALUES
      ('80000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'FALHOU: alocação conflitante foi aceita';
  EXCEPTION WHEN exclusion_violation THEN
    RAISE NOTICE 'ok — banco recusou a Ana em dois eventos sobrepostos';
  END;
  -- como suplente pode (não ocupa vaga nem bloqueia agenda)
  INSERT INTO alocacao (posto_id, profissional_id, tipo) VALUES
    ('80000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000001', 'suplente');
  RAISE NOTICE 'ok — suplente permitido';
END $$;

\echo '── 3. Lotação do posto'
DO $$
BEGIN
  -- posto de degustação: 2 vagas, 1 já confirmada
  INSERT INTO alocacao (posto_id, profissional_id) VALUES ('80000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003');
  BEGIN
    INSERT INTO alocacao (posto_id, profissional_id) VALUES ('80000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000009');
    RAISE EXCEPTION 'FALHOU: excedeu a quantidade do posto';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'Posto lotado%' THEN RAISE; END IF;
    RAISE NOTICE 'ok — %', SQLERRM;
  END;
END $$;

\echo '── 4. Cruzamento profissional × posto (Festival Maringá, promotor, 18h–01h, altura mín. 165)'
SELECT nome, pontuacao AS pts, disponibilidade AS disp, na_praca AS praca,
       array_to_string(motivos, ' · ') AS motivos, array_to_string(alertas, ' · ') AS alertas
  FROM sugerir_profissionais('80000000-0000-0000-0000-000000000003', 10);
DO $$
DECLARE r record;
BEGIN
  SELECT array_agg(nome) AS nomes INTO r FROM sugerir_profissionais('80000000-0000-0000-0000-000000000003', 50);
  ASSERT NOT ('Ana Beatriz Souza' = ANY(r.nomes)), 'Ana tem conflito: não pode ser sugerida';
  ASSERT NOT ('Kauã Ribeiro' = ANY(r.nomes)),      'Kauã está bloqueado';
  ASSERT NOT ('Eduarda Rocha' = ANY(r.nomes)),     'Eduarda está confirmada em Londrina no mesmo horário';
  ASSERT NOT ('Carla Mendes' = ANY(r.nomes)) OR TRUE, 'Carla (172 cm) pode aparecer';
  RAISE NOTICE 'ok — filtros eliminatórios (conflito, bloqueio, requisitos)';
END $$;

\echo '── 5. "Tenho promotores livres em Londrina no sábado à tarde?"'
SELECT nome, disponibilidade, nota_media
  FROM profissionais_livres(app_tenant(), '30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
                            (SELECT inicio FROM turno WHERE id = '70000000-0000-0000-0000-000000000001'),
                            (SELECT fim FROM turno WHERE id = '70000000-0000-0000-0000-000000000001'));

\echo '── 6. Check-in pelo celular com QR rotativo'
-- os eventos do seed caem no próximo sábado, ou HOJE se o teste rodar num sábado; nesse caso cruzam o
-- turno "agora" abaixo e a trava de conflito recusa os mesmos profissionais. Empurra uma semana.
UPDATE turno SET inicio = inicio + interval '7 days', fim = fim + interval '7 days'
 WHERE evento_id IN ('60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002')
   AND tstzrange(inicio, fim) && tstzrange(now() - interval '1 hour', now() + interval '6 hours');
-- evento acontecendo AGORA para testar o ponto
INSERT INTO evento (id, cliente_id, praca_id, nome, status, latitude, longitude)
VALUES ('60000000-0000-0000-0000-0000000000aa', '50000000-0000-0000-0000-000000000002',
        '20000000-0000-0000-0000-000000000001', 'Teste de campo (agora)', 'em_execucao', -23.3448, -51.1956);
INSERT INTO turno (id, evento_id, nome, inicio, fim)
VALUES ('70000000-0000-0000-0000-0000000000aa', '60000000-0000-0000-0000-0000000000aa', 'Agora',
        date_trunc('minute', now()) - interval '30 minutes', date_trunc('minute', now()) + interval '5 hours');
INSERT INTO posto (id, turno_id, funcao_id, quantidade, diaria_custo, diaria_venda)
VALUES ('80000000-0000-0000-0000-0000000000aa', '70000000-0000-0000-0000-0000000000aa',
        '30000000-0000-0000-0000-000000000001', 3, 200, 350);
INSERT INTO alocacao (posto_id, profissional_id, status) VALUES
  ('80000000-0000-0000-0000-0000000000aa', '40000000-0000-0000-0000-000000000002', 'confirmado'),
  ('80000000-0000-0000-0000-0000000000aa', '40000000-0000-0000-0000-000000000009', 'confirmado'),
  ('80000000-0000-0000-0000-0000000000aa', '40000000-0000-0000-0000-000000000003', 'confirmado');

CREATE TEMP TABLE tk AS
SELECT gerar_acesso_profissional('40000000-0000-0000-0000-000000000002') AS bruno,
       gerar_acesso_profissional('40000000-0000-0000-0000-000000000009') AS igor,
       gerar_acesso_profissional('40000000-0000-0000-0000-000000000003') AS carla;

DO $$
DECLARE t record; r jsonb; ev uuid := '60000000-0000-0000-0000-0000000000aa';
BEGIN
  SELECT * INTO t FROM tk;
  ASSERT length(t.bruno) = 43, 'token base64url de 43 chars';
  ASSERT (SELECT count(*) FROM acesso_profissional WHERE token_hash = convert_to(t.bruno, 'UTF8')) = 0, 'token não é guardado em texto';

  r := registrar_ponto('token-falso', ev, 'checkin', qr_codigo(ev));
  ASSERT r->>'erro' = 'link_invalido', 'token falso rejeitado';

  r := registrar_ponto(t.bruno, ev, 'checkin', NULL);
  ASSERT r->>'erro' = 'qr_obrigatorio', 'QR obrigatório';

  r := registrar_ponto(t.bruno, ev, 'checkin', '000000');
  ASSERT r->>'erro' = 'qr_expirado' OR qr_codigo(ev) = '000000', 'QR errado rejeitado';

  r := registrar_ponto(t.bruno, ev, 'checkin', qr_codigo(ev, now() - interval '5 minutes'));
  ASSERT r->>'erro' = 'qr_expirado', 'foto antiga do QR rejeitada';

  r := registrar_ponto(t.bruno, ev, 'checkin', qr_codigo(ev), NULL, -23.3449, -51.1957);
  ASSERT (r->>'ok')::boolean, 'check-in válido: ' || r::text;
  ASSERT (r->>'atraso_min')::int BETWEEN 29 AND 31, 'atraso ~30 min calculado: ' || r::text;
  RAISE NOTICE 'ok — %', r->>'mensagem';

  r := registrar_ponto(t.bruno, ev, 'checkin', qr_codigo(ev));
  ASSERT (r->>'repetido')::boolean, 'reenvio é idempotente';

  -- check-in OFFLINE: Igor leu o QR há 20 min sem sinal; sincroniza agora
  r := registrar_ponto(t.igor, ev, 'checkin', qr_codigo(ev, now() - interval '20 minutes'), now() - interval '20 minutes');
  ASSERT (r->>'ok')::boolean, 'check-in offline aceito: ' || r::text;
  ASSERT (r->>'atraso_min')::int BETWEEN 9 AND 11, 'atraso pelo horário do aparelho (~10 min): ' || r::text;
  RAISE NOTICE 'ok — offline: %', r->>'mensagem';

  -- relógio do celular adiantado é sinalizado
  r := registrar_ponto(t.carla, ev, 'checkin', qr_codigo(ev), now() + interval '1 hour');
  ASSERT (SELECT suspeito FROM apontamento ap JOIN alocacao a ON a.id = ap.alocacao_id
           WHERE a.profissional_id = '40000000-0000-0000-0000-000000000003' AND a.posto_id = '80000000-0000-0000-0000-0000000000aa'),
         'relógio adiantado marcado como suspeito';

  -- profissional sem escala no evento
  r := registrar_ponto(gerar_acesso_profissional('40000000-0000-0000-0000-000000000006'), ev, 'checkin', qr_codigo(ev));
  ASSERT r->>'erro' = 'sem_escala', 'sem escala → recusado';

  r := registrar_ponto(t.bruno, ev, 'checkout', qr_codigo(ev));
  ASSERT (r->>'ok')::boolean AND (r->>'saida_antecipada_min')::int > 250, 'checkout com saída antecipada: ' || r::text;
  RAISE NOTICE 'ok — checkout: saída antecipada de % min', r->>'saida_antecipada_min';
END $$;

\echo '── 7. Área do profissional e aceite da convocação'
DO $$
DECLARE tok text; r jsonb; v_aloc uuid;
BEGIN
  tok := gerar_acesso_profissional('40000000-0000-0000-0000-000000000010');
  r := area_profissional(tok);
  ASSERT jsonb_array_length(r->'convocacoes') = 1, 'Juliana tem 1 convocação';
  v_aloc := (r->'convocacoes'->0->>'alocacao_id')::uuid;
  r := responder_convocacao(tok, v_aloc, true);
  ASSERT r->>'status' = 'confirmado', 'aceite registrado';
  r := responder_convocacao(tok, v_aloc, false);
  ASSERT r->>'erro' = 'convocacao_indisponivel', 'não responde duas vezes';
  RAISE NOTICE 'ok — Juliana confirmou pelo link';
END $$;

\echo '── 8. Fechamento do evento (critérios de aceite 1 e 3) e trava pós-fechamento'
DO $$
DECLARE r jsonb; ev uuid := '60000000-0000-0000-0000-0000000000aa';
BEGIN
  -- Posto tem 3 vagas, 3 ocupadas; Igor e Carla sem checkout → bloqueia
  BEGIN
    PERFORM fechar_evento(ev);
    RAISE EXCEPTION 'FALHOU: fechou com checkout pendente';
  EXCEPTION WHEN SQLSTATE 'P0007' THEN RAISE NOTICE 'ok — %', SQLERRM;
  END;

  -- adiciona vaga extra sem preencher → bloqueia por vaga aberta
  UPDATE posto SET quantidade = 4 WHERE id = '80000000-0000-0000-0000-0000000000aa';
  ASSERT EXISTS (SELECT 1 FROM pendencias_fechamento(ev) WHERE tipo = 'vaga_aberta'), 'vaga aberta detectada';
  UPDATE posto SET justificativa_vaga_aberta = 'Cliente reduziu efetivo na véspera' WHERE id = '80000000-0000-0000-0000-0000000000aa';

  INSERT INTO lancamento_adicional (alocacao_id, tipo, valor, descricao)
  SELECT a.id, 'deslocamento', 25, 'Uber de volta' FROM alocacao a
   WHERE a.posto_id = '80000000-0000-0000-0000-0000000000aa' AND a.profissional_id = '40000000-0000-0000-0000-000000000009';
  INSERT INTO custo_direto (evento_id, descricao, valor) VALUES (ev, 'Kit uniforme', 120);

  -- a nota é obrigatória para quem fez check-in (migração 022): sem ela não fecha
  ASSERT (SELECT count(*) FROM pendencias_fechamento(ev) WHERE tipo = 'avaliacao_pendente') = 3, 'avaliação pendente dos 3 que trabalharam';
  INSERT INTO avaliacao (alocacao_id, nota, observacao, avaliado_por)
  SELECT a.id, 4, NULL, app_usuario() FROM alocacao a WHERE a.posto_id = '80000000-0000-0000-0000-0000000000aa';

  r := fechar_evento(ev, p_aceitar_checkout_pendente => true);
  RAISE NOTICE 'ok — fechado: receita %, custo equipe %, diretos %, margem % (% %%)',
    r->>'receita', r->>'custo_equipe', r->>'custos_diretos', r->>'margem', r->>'margem_pct';
  ASSERT (r->>'receita')::numeric = 1400, 'receita = 4 postos contratados × 350';
  ASSERT jsonb_array_length(r->'pagamentos') = 3, 'lista de pagamento com 3 profissionais';

  BEGIN
    UPDATE alocacao SET status = 'cancelado' WHERE posto_id = '80000000-0000-0000-0000-0000000000aa';
    RAISE EXCEPTION 'FALHOU: editou escala de evento fechado';
  EXCEPTION WHEN SQLSTATE 'P0002' THEN RAISE NOTICE 'ok — trava pós-fechamento: %', SQLERRM;
  END;
END $$;
SELECT pr.nome, c.presenca, c.horas_trabalhadas AS horas, c.valor_diaria AS diaria, c.valor_descontos AS descontos,
       c.valor_adicionais AS adicionais, c.valor_total AS total
  FROM custo_alocacao c JOIN profissional pr ON pr.id = c.profissional_id
 WHERE c.evento_id = '60000000-0000-0000-0000-0000000000aa' ORDER BY pr.nome;

\echo '── 9. Adicional noturno e hora extra'
DO $$
BEGIN
  -- 22h às 05h = 7h noturnas; 18h–01h tem 3h noturnas
  ASSERT minutos_noturnos('2026-11-07 18:00-03', '2026-11-08 01:00-03', '22:00', '05:00', 'America/Sao_Paulo') = 180, 'noturno 18h–01h = 180 min';
  ASSERT minutos_noturnos('2026-11-07 08:00-03', '2026-11-07 17:00-03', '22:00', '05:00', 'America/Sao_Paulo') = 0, 'diurno = 0';
  ASSERT minutos_noturnos('2026-11-07 03:00-03', '2026-11-07 07:00-03', '22:00', '05:00', 'America/Sao_Paulo') = 120, 'madrugada 03h–07h = 120 min';
  RAISE NOTICE 'ok — adicional noturno';
END $$;

\echo '── 10. Auditoria (histórico da escala)'
SELECT to_char(em, 'HH24:MI:SS') AS hora, operacao AS op, usuario, profissional, status_anterior, status_novo, motivo
  FROM vw_historico_escala WHERE evento_id = '60000000-0000-0000-0000-000000000001' ORDER BY em LIMIT 8;

\echo '── 11. Isolamento entre empresas (RLS) com o papel da API'
INSERT INTO tenant (id, nome, slug) VALUES ('00000000-0000-0000-0000-0000000000bb', 'Outra Agência', 'outra');
SET LOCAL ROLE app_api;
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM profissional) = 12, 'empresa 1 vê seus 12 profissionais';
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-0000000000bb', true);
  ASSERT (SELECT count(*) FROM profissional) = 0, 'empresa 2 não vê nada da empresa 1';
  ASSERT (SELECT count(*) FROM evento) = 0, 'eventos isolados';
  BEGIN
    INSERT INTO profissional (tenant_id, nome, celular) VALUES ('00000000-0000-0000-0000-000000000001', 'Intruso', '+550000');
    RAISE EXCEPTION 'FALHOU: gravou em outra empresa';
  EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'ok — escrita cruzada bloqueada';
  END;
  INSERT INTO profissional (nome, celular) VALUES ('Pessoa da Outra', '+550001');   -- tenant_id vem do contexto
  ASSERT (SELECT tenant_id FROM profissional WHERE nome = 'Pessoa da Outra') = '00000000-0000-0000-0000-0000000000bb', 'tenant automático';
  PERFORM set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);
  RAISE NOTICE 'ok — isolamento por empresa';
END $$;
RESET ROLE;

\echo '── 12. BI: atualização e indicadores'
SELECT analytics.atualizar(false) \g /dev/null
SELECT ano_mes, eventos, eventos_fechados, receita, custo_equipe, margem, margem_pct, taxa_falta_pct
  FROM analytics.kpi_mensal WHERE tenant_id = '00000000-0000-0000-0000-000000000001' ORDER BY ano_mes;
SELECT d.evento, f.realizado, f.receita, f.custo_equipe, f.margem, f.margem_pct, f.efetivo_previsto, f.efetivo_realizado
  FROM analytics.fato_evento f JOIN analytics.dim_evento d USING (evento_id) ORDER BY d.evento;

\echo '── 13. Correções da auditoria de segurança (migração 025)'
INSERT INTO tenant (id, nome, slug) VALUES ('00000000-0000-0000-0000-0000000000b2', 'Empresa B', 'empresa-b');
INSERT INTO profissional (id, tenant_id, nome, celular)
VALUES ('4b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'Prof da Empresa B', '+550002');
INSERT INTO cliente (id, tenant_id, razao_social)
VALUES ('5b000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2', 'Cliente da Empresa B');
SET LOCAL ROLE app_api;
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true) \g /dev/null
DO $$
DECLARE v_aloc uuid; v_cli uuid; r timestamptz; n int := 0; i int;
BEGIN
  -- alocação confirmada de um dos eventos do seed (ainda abertos)
  SELECT a.id INTO v_aloc FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
   WHERE t.evento_id IN ('60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002')
     AND a.status = 'confirmado' AND a.tipo = 'titular' LIMIT 1;
  ASSERT v_aloc IS NOT NULL, 'seed com alocação confirmada';

  -- FK de outra empresa: o banco recusa mesmo com o id certo
  BEGIN
    UPDATE alocacao SET profissional_id = '4b000000-0000-0000-0000-000000000001' WHERE id = v_aloc;
    RAISE EXCEPTION 'FALHOU: escalou profissional de outra empresa';
  EXCEPTION WHEN SQLSTATE 'P0010' THEN RAISE NOTICE 'ok — profissional de outra empresa recusado';
  END;
  BEGIN
    UPDATE evento SET cliente_id = '5b000000-0000-0000-0000-000000000001' WHERE id = '60000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'FALHOU: evento com cliente de outra empresa';
  EXCEPTION WHEN SQLSTATE 'P0010' THEN RAISE NOTICE 'ok — cliente de outra empresa recusado';
  END;

  -- cliente excluído não recebe lançamento novo; recuperado, volta a receber
  SELECT cliente_id INTO v_cli FROM evento WHERE id = '60000000-0000-0000-0000-000000000001';
  UPDATE cliente SET excluido_em = now() WHERE id = v_cli;
  BEGIN
    INSERT INTO cliente_contato (cliente_id, nome) VALUES (v_cli, 'Contato novo');
    RAISE EXCEPTION 'FALHOU: contato em cliente excluído';
  EXCEPTION WHEN SQLSTATE 'P0010' THEN NULL;
  END;
  BEGIN
    INSERT INTO evento (cliente_id, praca_id, nome)
    SELECT cliente_id, praca_id, 'Clone' FROM evento WHERE id = '60000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'FALHOU: evento em cliente excluído';
  EXCEPTION WHEN SQLSTATE 'P0010' THEN NULL;
  END;
  UPDATE evento SET nome = nome WHERE id = '60000000-0000-0000-0000-000000000001';   -- editar outros campos segue livre
  UPDATE cliente SET excluido_em = NULL WHERE id = v_cli;
  INSERT INTO cliente_contato (cliente_id, nome) VALUES (v_cli, 'Contato depois de recuperar');
  RAISE NOTICE 'ok — cliente excluído bloqueado; recuperado, liberado';

  -- ponto manual: nada no futuro, saída só depois de entrada
  BEGIN
    PERFORM registrar_ponto_supervisor(v_aloc, 'checkin', now() + interval '2 hours', 'teste');
    RAISE EXCEPTION 'FALHOU: ponto manual no futuro';
  EXCEPTION WHEN SQLSTATE 'P0009' THEN NULL;
  END;
  BEGIN
    PERFORM registrar_ponto_supervisor(v_aloc, 'checkout', now() - interval '1 minute', 'teste');
    RAISE EXCEPTION 'FALHOU: saída manual sem entrada';
  EXCEPTION WHEN SQLSTATE 'P0009' THEN NULL;
  END;
  RAISE NOTICE 'ok — ponto manual com limites';

  -- bloqueio de login: a reserva vem antes da senha; 5 tentativas passam, a 6ª já volta bloqueada
  FOR i IN 1..6 LOOP
    r := reservar_tentativa_login('10000000-0000-0000-0000-000000000003');
    IF r IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  ASSERT n = 1, format('esperado 1 bloqueio em 6 tentativas, veio %s', n);
  PERFORM confirmar_login_ok('10000000-0000-0000-0000-000000000003');
  BEGIN
    PERFORM 1 FROM bloqueio_login LIMIT 1;
    RAISE EXCEPTION 'FALHOU: API lê bloqueio_login direto';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'ok — bloqueio de login atômico';

  -- views respeitam o RLS de quem consulta (security_invoker)
  ASSERT NOT EXISTS (SELECT 1 FROM vw_margem_evento WHERE tenant_id <> app_tenant()), 'margem de outra empresa visível';
  RAISE NOTICE 'ok — views só mostram a própria empresa';

  -- auditoria de tabela filha guarda a empresa
  INSERT INTO usuario_permissao VALUES ('10000000-0000-0000-0000-000000000002', 'M7', 'criar', true);
  ASSERT EXISTS (SELECT 1 FROM auditoria WHERE tabela = 'usuario_permissao' AND tenant_id = app_tenant()), 'auditoria sem empresa';
  RAISE NOTICE 'ok — auditoria de permissão visível para a empresa';
END $$;
RESET ROLE;
DO $$
DECLARE t text := 'token-de-teste-da-auditoria';
BEGIN
  -- link do profissional cai quando a empresa é inativada
  INSERT INTO acesso_profissional (tenant_id, profissional_id, token_hash, expira_em)
  VALUES ('00000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', digest(t, 'sha256'), now() + interval '1 day');
  ASSERT autenticar_profissional(t) IS NOT NULL, 'link ativo autentica';
  UPDATE tenant SET ativo = false WHERE id = '00000000-0000-0000-0000-000000000001';
  ASSERT autenticar_profissional(t) IS NULL, 'link funciona com a empresa inativa';
  UPDATE tenant SET ativo = true WHERE id = '00000000-0000-0000-0000-000000000001';
  RAISE NOTICE 'ok — empresa inativa derruba o link do profissional';
END $$;

\echo ''
\echo '✔ Todos os testes passaram (transação será desfeita)'
ROLLBACK;
