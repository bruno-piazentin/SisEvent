-- =====================================================================
-- 014 — Evento: CEP do local e observações em texto livre
--   (ex.: "Pausa para almoço das 12h às 14h")
-- A clonagem passa a copiar também CEP, observações e contato do local.
-- =====================================================================

ALTER TABLE evento
  ADD COLUMN cep         char(8) CHECK (cep ~ '^\d{8}$'),
  ADD COLUMN observacoes text;

CREATE OR REPLACE FUNCTION clonar_evento(p_origem uuid, p_novo_inicio timestamptz, p_nome text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_novo uuid; v_delta interval; r record; v_turno uuid;
BEGIN
  SELECT p_novo_inicio - min(inicio) INTO v_delta FROM turno WHERE evento_id = p_origem;
  INSERT INTO evento (tenant_id, cliente_id, oportunidade_id, praca_id, nome, marca, descricao, local_nome, cep, endereco,
                      latitude, longitude, contato_local_nome, contato_local_telefone, contato_local_email, observacoes,
                      exige_qr, exige_geolocalizacao, raio_geo_m, exige_selfie,
                      tolerancia_atraso_min, checkin_antecedencia_min, metas, requisitos, clonado_de)
  SELECT tenant_id, cliente_id, NULL, praca_id, COALESCE(p_nome, nome || ' (cópia)'), marca, descricao, local_nome, cep, endereco,
         latitude, longitude, contato_local_nome, contato_local_telefone, contato_local_email, observacoes,
         exige_qr, exige_geolocalizacao, raio_geo_m, exige_selfie,
         tolerancia_atraso_min, checkin_antecedencia_min, metas, requisitos, id
    FROM evento WHERE id = p_origem
  RETURNING id INTO v_novo;

  FOR r IN SELECT * FROM turno WHERE evento_id = p_origem ORDER BY inicio LOOP
    INSERT INTO turno (tenant_id, evento_id, nome, inicio, fim)
    VALUES (r.tenant_id, v_novo, r.nome, r.inicio + COALESCE(v_delta, '0'), r.fim + COALESCE(v_delta, '0'))
    RETURNING id INTO v_turno;
    INSERT INTO posto (tenant_id, turno_id, funcao_id, quantidade, diaria_custo, diaria_venda, uniforme, requisitos)
    SELECT tenant_id, v_turno, funcao_id, quantidade, diaria_custo, diaria_venda, uniforme, requisitos
      FROM posto WHERE turno_id = r.id;
  END LOOP;

  INSERT INTO checklist_item (tenant_id, evento_id, descricao, responsavel_id)
  SELECT tenant_id, v_novo, descricao, responsavel_id FROM checklist_item WHERE evento_id = p_origem;
  RETURN v_novo;
END $$;
