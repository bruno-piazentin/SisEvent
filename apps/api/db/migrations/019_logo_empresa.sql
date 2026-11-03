-- =====================================================================
-- 019 — Logo de cada empresa
--
-- O sistema é o SisEvent; cada empresa cliente pode ter o próprio logo,
-- mostrado no menu do painel e na área do profissional. Fica no banco como
-- data URL já reduzida no navegador (até ~220 KB), igual às fotos.
-- =====================================================================

ALTER TABLE tenant ADD COLUMN logo text
  CHECK (logo IS NULL OR (logo ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' AND length(logo) <= 300000));

-- Área do profissional: passa a dizer de qual empresa é o convite (antes o nome era fixo na tela)
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
