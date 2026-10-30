-- =====================================================================
-- 004 — Acesso do profissional por link (sem senha) e check-in/out (M6)
--
-- Fluxo:
--  1. A central gera um link mágico:  https://app/p/<token>   (enviado por WhatsApp/SMS)
--     Só o hash SHA-256 do token fica no banco.
--  2. No local, o supervisor abre a tela do QR rotativo do evento.
--     O QR contém https://app/c/<evento_id>/<codigo>; o código muda a cada 30 s
--     (HMAC do segredo do evento), então foto do QR enviada ao colega expira.
--  3. O profissional escaneia com a câmera do celular; a página usa o token
--     salvo no aparelho e chama registrar_ponto().
-- =====================================================================

CREATE TABLE acesso_profissional (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenant(id) ON DELETE CASCADE,
  profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  token_hash      bytea NOT NULL UNIQUE,
  expira_em       timestamptz NOT NULL,
  revogado_em     timestamptz,
  ultimo_uso_em   timestamptz,
  criado_por      uuid REFERENCES usuario(id),
  criado_em       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_acesso_prof ON acesso_profissional (profissional_id);

-- Código curto de recuperação (6 dígitos por SMS/WhatsApp) quando o link expira
CREATE TABLE codigo_otp (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profissional_id uuid NOT NULL REFERENCES profissional(id) ON DELETE CASCADE,
  codigo_hash     bytea NOT NULL,
  expira_em       timestamptz NOT NULL,
  tentativas      smallint NOT NULL DEFAULT 0,
  usado_em        timestamptz
);

-- Gera link de acesso. Retorna o token em texto UMA vez (não é recuperável depois).
CREATE OR REPLACE FUNCTION gerar_acesso_profissional(p_profissional uuid, p_validade interval DEFAULT '30 days')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_token text; v_tenant uuid;
BEGIN
  SELECT tenant_id INTO v_tenant FROM profissional WHERE id = p_profissional AND status <> 'bloqueado';
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Profissional inexistente ou bloqueado' USING ERRCODE = 'P0003';
  END IF;
  -- 32 bytes aleatórios em base64url (43 caracteres)
  v_token := rtrim(translate(encode(gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  INSERT INTO acesso_profissional (tenant_id, profissional_id, token_hash, expira_em, criado_por)
  VALUES (v_tenant, p_profissional, digest(v_token, 'sha256'), now() + p_validade, app_usuario());
  RETURN v_token;
END $$;

-- Valida token → profissional (ou NULL). Atualiza último uso.
CREATE OR REPLACE FUNCTION autenticar_profissional(p_token text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_prof uuid;
BEGIN
  UPDATE acesso_profissional a SET ultimo_uso_em = now()
    FROM profissional p
   WHERE a.token_hash = digest(p_token, 'sha256')
     AND a.revogado_em IS NULL AND a.expira_em > now()
     AND p.id = a.profissional_id AND p.status <> 'bloqueado'
  RETURNING a.profissional_id INTO v_prof;
  RETURN v_prof;
END $$;

-- ---------------------------------------------------------------------
-- QR rotativo (código de 6 dígitos, janela de 30 s, estilo TOTP)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION qr_codigo(p_evento uuid, p_momento timestamptz DEFAULT now())
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT lpad(
           ((('x' || substr(encode(hmac(convert_to(floor(extract(epoch FROM p_momento) / 30)::bigint::text, 'UTF8'), e.qr_segredo, 'sha256'), 'hex'), 1, 8))::bit(32)::bigint)
            % 1000000)::text,
           6, '0')
    FROM evento e WHERE e.id = p_evento
$$;

-- Aceita a janela atual e a anterior (até ~60 s), cobrindo leitura lenta.
-- Para ponto registrado OFFLINE (sem sinal no local), o celular guarda o código lido e a
-- hora da leitura; na sincronização o código é validado contra a hora do aparelho
-- (até 12 h atrás). Como o código é um HMAC do tempo, não dá para "adivinhar" códigos.
CREATE OR REPLACE FUNCTION qr_valido(p_evento uuid, p_codigo text, p_momento timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT p_codigo IN (qr_codigo(p_evento, p_momento), qr_codigo(p_evento, p_momento - interval '30 seconds'))
$$;

-- Distância em metros (haversine) para a geolocalização opcional
CREATE OR REPLACE FUNCTION distancia_m(lat1 numeric, lng1 numeric, lat2 numeric, lng2 numeric)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT 2 * 6371000 * asin(sqrt(
           power(sin(radians((lat2 - lat1)::float8) / 2), 2) +
           cos(radians(lat1::float8)) * cos(radians(lat2::float8)) *
           power(sin(radians((lng2 - lng1)::float8) / 2), 2)))
$$;

-- ---------------------------------------------------------------------
-- Registro de ponto pelo próprio profissional (link ou QR)
-- Retorna JSON pronto para a tela do celular.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION registrar_ponto(
  p_token          text,
  p_evento         uuid,
  p_tipo           text,                       -- 'checkin' | 'checkout'
  p_codigo_qr      text DEFAULT NULL,
  p_dispositivo_em timestamptz DEFAULT NULL,   -- hora do celular (sincronização offline)
  p_lat            numeric DEFAULT NULL,
  p_lng            numeric DEFAULT NULL,
  p_selfie_url     text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql AS $$
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

  -- Hora do aparelho: só é considerada para sincronização offline (passado, até 12 h)
  IF p_dispositivo_em IS NOT NULL THEN
    IF p_dispositivo_em > v_agora + interval '5 minutes' THEN
      v_suspeito := true; v_obs := v_obs || 'relógio do celular adiantado'::text;
    ELSIF p_dispositivo_em < v_agora - interval '2 minutes' AND p_dispositivo_em > v_agora - interval '12 hours' THEN
      v_offline := true; v_obs := v_obs || format('sincronizado offline (%s min depois)',
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
END $$;

-- Ponto lançado pelo supervisor (celular sem bateria, sem internet etc.)
CREATE OR REPLACE FUNCTION registrar_ponto_supervisor(
  p_alocacao uuid, p_tipo text, p_momento timestamptz, p_observacao text
) RETURNS apontamento LANGUAGE plpgsql AS $$
DECLARE v_apt apontamento%ROWTYPE; v_inicio timestamptz; v_fim timestamptz; v_tenant uuid;
BEGIN
  IF p_observacao IS NULL OR length(trim(p_observacao)) < 5 THEN
    RAISE EXCEPTION 'Lançamento manual exige observação' USING ERRCODE = 'P0004';
  END IF;
  SELECT t.inicio, t.fim, a.tenant_id INTO v_inicio, v_fim, v_tenant
    FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
   WHERE a.id = p_alocacao AND a.status = 'confirmado';
  IF NOT FOUND THEN RAISE EXCEPTION 'Alocação não confirmada' USING ERRCODE = 'P0005'; END IF;

  INSERT INTO apontamento (tenant_id, alocacao_id) VALUES (v_tenant, p_alocacao) ON CONFLICT (alocacao_id) DO NOTHING;

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
END $$;

-- Substituição em campo: cancela quem faltou e confirma o substituto no mesmo posto
CREATE OR REPLACE FUNCTION substituir_em_campo(p_alocacao uuid, p_substituto uuid, p_motivo text)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_posto uuid; v_nova uuid; v_tenant uuid;
BEGIN
  IF p_motivo IS NULL OR length(trim(p_motivo)) < 5 THEN
    RAISE EXCEPTION 'Substituição exige motivo' USING ERRCODE = 'P0004';
  END IF;
  UPDATE alocacao SET status = 'substituido', motivo = p_motivo
   WHERE id = p_alocacao AND status = 'confirmado'
  RETURNING posto_id, tenant_id INTO v_posto, v_tenant;
  IF v_posto IS NULL THEN RAISE EXCEPTION 'Alocação não confirmada' USING ERRCODE = 'P0005'; END IF;

  INSERT INTO apontamento (tenant_id, alocacao_id, status, observacao)
  VALUES (v_tenant, p_alocacao, 'falta', 'Substituído: ' || p_motivo)
  ON CONFLICT (alocacao_id) DO UPDATE SET status = CASE WHEN apontamento.checkin_em IS NULL THEN 'falta'::status_presenca ELSE apontamento.status END;

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
END $$;
