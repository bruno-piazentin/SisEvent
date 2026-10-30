-- =====================================================================
-- 006 — Cruzamento promotor × posto (o "match" do banco de talentos)
--
-- Responde: "quem são os melhores candidatos para este posto?" e também
-- "tenho 12 promotores livres em Maringá no sábado?".
--
-- Filtros eliminatórios: ativo, exerce a função, sem conflito de horário,
-- sem indisponibilidade, requisitos rígidos do posto (altura, gênero,
-- idade, CNH, idiomas, nível). O resto vira pontuação de 0 a 100 com
-- motivos e alertas legíveis para a central.
-- =====================================================================

-- Cobertura da disponibilidade declarada sobre um intervalo:
--   2 = cobre o turno inteiro, 1 = cobre parte, 0 = não declarou para esse horário
CREATE OR REPLACE FUNCTION cobertura_disponibilidade(p_prof uuid, p_inicio timestamptz, p_fim timestamptz, p_tz text)
RETURNS smallint LANGUAGE sql STABLE AS $$
  WITH alvo AS (
    SELECT tsrange(p_inicio AT TIME ZONE p_tz, p_fim AT TIME ZONE p_tz, '[)') AS r,
           (p_inicio AT TIME ZONE p_tz)::date AS d
  ),
  janelas AS (  -- materializa as janelas semanais em datas concretas (dia anterior, do dia e seguinte)
    SELECT tsrange(dd + ds.hora_inicio,
                   CASE WHEN ds.hora_fim <= ds.hora_inicio THEN dd + 1 + ds.hora_fim ELSE dd + ds.hora_fim END,
                   '[)') AS r
      FROM alvo, disponibilidade_semanal ds,
           LATERAL (SELECT generate_series(alvo.d - 1, alvo.d + 1, '1 day')::date AS dd) g
     WHERE ds.profissional_id = p_prof AND ds.dia_semana = extract(dow FROM g.dd)
  ),
  uniao AS (SELECT range_agg(r) AS m FROM janelas)
  SELECT CASE WHEN uniao.m IS NULL THEN 0
              WHEN uniao.m @> alvo.r THEN 2
              WHEN uniao.m && alvo.r THEN 1
              ELSE 0 END::smallint
    FROM alvo, uniao
$$;

-- Indicadores históricos por profissional (nota média e assiduidade)
CREATE OR REPLACE VIEW vw_historico_profissional AS
SELECT pr.id AS profissional_id, pr.tenant_id,
       count(DISTINCT a.id) FILTER (WHERE ap.status IN ('presente','falta')) AS jobs_finalizados,
       count(DISTINCT a.id) FILTER (WHERE ap.status = 'presente') AS presencas,
       count(DISTINCT a.id) FILTER (WHERE ap.status = 'falta') AS faltas,
       count(DISTINCT a.id) FILTER (WHERE ap.status = 'presente' AND ap.atraso_min > 10) AS atrasos,
       count(DISTINCT a.id) FILTER (WHERE a.status = 'recusado') AS recusas,
       round(avg(av.nota), 2) AS nota_media,
       count(av.nota) AS avaliacoes,
       max(t.inicio) FILTER (WHERE ap.status = 'presente') AS ultimo_job
  FROM profissional pr
  LEFT JOIN alocacao a ON a.profissional_id = pr.id
  LEFT JOIN posto p ON p.id = a.posto_id
  LEFT JOIN turno t ON t.id = p.turno_id
  LEFT JOIN apontamento ap ON ap.alocacao_id = a.id
  LEFT JOIN avaliacao av ON av.alocacao_id = a.id
 GROUP BY pr.id, pr.tenant_id;

CREATE OR REPLACE FUNCTION sugerir_profissionais(p_posto uuid, p_limite int DEFAULT 50, p_incluir_em_teste boolean DEFAULT true)
RETURNS TABLE (
  profissional_id uuid, nome text, celular text, cidade text, foto_url text,
  pontuacao int, disponibilidade text, na_praca text, nota_media numeric, assiduidade_pct numeric,
  motivos text[], alertas text[]
) LANGUAGE sql STABLE AS $$
  WITH ctx AS (
    SELECT p.id AS posto_id, p.funcao_id, p.requisitos AS req, t.inicio, t.fim, e.praca_id, e.tenant_id,
           tn.fuso_horario AS tz,
           ((t.fim AT TIME ZONE tn.fuso_horario)::time >= '23:00' OR (t.fim AT TIME ZONE tn.fuso_horario)::time < '05:00'
             OR (t.fim AT TIME ZONE tn.fuso_horario)::date > (t.inicio AT TIME ZONE tn.fuso_horario)::date) AS termina_tarde
      FROM posto p JOIN turno t ON t.id = p.turno_id JOIN evento e ON e.id = t.evento_id
      JOIN tenant tn ON tn.id = e.tenant_id
     WHERE p.id = p_posto
  ),
  candidatos AS (
    SELECT pr.*, pf.nivel, ctx.*,
           cobertura_disponibilidade(pr.id, ctx.inicio, ctx.fim, ctx.tz) AS cob,
           CASE WHEN pr.praca_base_id = ctx.praca_id THEN 2
                WHEN EXISTS (SELECT 1 FROM profissional_praca pp WHERE pp.profissional_id = pr.id AND pp.praca_id = ctx.praca_id) THEN 1
                ELSE 0 END AS praca_match,
           h.nota_media AS h_nota, h.jobs_finalizados, h.presencas, h.faltas,
           date_part('year', age(ctx.inicio::date, pr.data_nascimento))::int AS idade
      FROM ctx
      JOIN profissional pr ON pr.tenant_id = ctx.tenant_id
      JOIN profissional_funcao pf ON pf.profissional_id = pr.id AND pf.funcao_id = ctx.funcao_id
      LEFT JOIN vw_historico_profissional h ON h.profissional_id = pr.id
     WHERE (pr.status = 'ativo' OR (p_incluir_em_teste AND pr.status = 'em_teste'))
       -- já está neste posto
       AND NOT EXISTS (SELECT 1 FROM alocacao a WHERE a.posto_id = ctx.posto_id AND a.profissional_id = pr.id
                         AND a.status IN ('convidado','confirmado'))
       -- conflito de horário com outro evento
       AND NOT EXISTS (SELECT 1 FROM alocacao a WHERE a.profissional_id = pr.id AND a.tipo = 'titular'
                         AND a.status IN ('convidado','confirmado')
                         AND a.periodo && tstzrange(ctx.inicio, ctx.fim, '[)'))
       -- indisponibilidade pontual
       AND NOT EXISTS (SELECT 1 FROM indisponibilidade i WHERE i.profissional_id = pr.id
                         AND i.periodo && tstzrange(ctx.inicio, ctx.fim, '[)'))
       -- requisitos rígidos do posto
       AND (ctx.req->>'altura_min' IS NULL OR pr.altura_cm >= (ctx.req->>'altura_min')::int)
       AND (ctx.req->>'altura_max' IS NULL OR pr.altura_cm <= (ctx.req->>'altura_max')::int)
       AND (ctx.req->'generos' IS NULL OR jsonb_array_length(ctx.req->'generos') = 0
            OR pr.genero IN (SELECT jsonb_array_elements_text(ctx.req->'generos')))
       AND (ctx.req->>'idade_min' IS NULL OR date_part('year', age(ctx.inicio::date, pr.data_nascimento)) >= (ctx.req->>'idade_min')::int)
       AND (ctx.req->>'idade_max' IS NULL OR date_part('year', age(ctx.inicio::date, pr.data_nascimento)) <= (ctx.req->>'idade_max')::int)
       AND (COALESCE((ctx.req->>'exige_cnh')::boolean, false) = false
            OR (pr.cnh_categoria IS NOT NULL AND (pr.cnh_validade IS NULL OR pr.cnh_validade >= ctx.inicio::date)))
       AND (ctx.req->'idiomas' IS NULL OR jsonb_array_length(ctx.req->'idiomas') = 0
            OR pr.idiomas @> ARRAY(SELECT jsonb_array_elements_text(ctx.req->'idiomas')))
       AND (ctx.req->>'nivel_min' IS NULL OR pf.nivel >= (ctx.req->>'nivel_min')::int)
  ),
  pontuado AS (
    SELECT c.*,
      -- disponibilidade declarada: 30
      (CASE c.cob WHEN 2 THEN 30 WHEN 1 THEN 12 ELSE 0 END)
      -- praça: 20
      + (CASE c.praca_match WHEN 2 THEN 20 WHEN 1 THEN 14 ELSE 0 END)
      -- nota média: 20 (sem avaliação = 10, neutro)
      + COALESCE(round(c.h_nota / 5.0 * 20), 10)
      -- assiduidade: 15 (sem histórico = 9)
      + CASE WHEN COALESCE(c.jobs_finalizados, 0) = 0 THEN 9
             ELSE round(15.0 * c.presencas / c.jobs_finalizados) END
      -- nível na função: 10
      + (c.nivel - 1) * 5
      -- locomoção adequada: 5
      + CASE WHEN c.req->'locomocao' IS NOT NULL
               AND c.meios_locomocao && ARRAY(SELECT jsonb_array_elements_text(c.req->'locomocao'))::meio_locomocao[] THEN 5
             WHEN c.req->'locomocao' IS NULL AND c.meios_locomocao && ARRAY['carro_proprio','moto_propria']::meio_locomocao[] THEN 3
             ELSE 0 END
      AS score_bruto
    FROM candidatos c
  )
  SELECT p.id, p.nome, p.celular, p.cidade, p.foto_url,
         LEAST(100, GREATEST(0, p.score_bruto
           - CASE WHEN p.termina_tarde AND p.meios_locomocao <@ ARRAY['transporte_publico','a_pe']::meio_locomocao[]
                       AND cardinality(p.meios_locomocao) > 0 THEN 8 ELSE 0 END))::int,
         CASE p.cob WHEN 2 THEN 'total' WHEN 1 THEN 'parcial' ELSE 'não declarada' END,
         CASE p.praca_match WHEN 2 THEN 'base' WHEN 1 THEN 'aceita' ELSE 'fora' END,
         p.h_nota,
         CASE WHEN COALESCE(p.jobs_finalizados,0) = 0 THEN NULL ELSE round(100.0 * p.presencas / p.jobs_finalizados, 1) END,
         array_remove(ARRAY[
           CASE p.cob WHEN 2 THEN 'Disponível no horário' WHEN 1 THEN 'Disponível em parte do turno' END,
           CASE p.praca_match WHEN 2 THEN 'Mora na praça do evento' WHEN 1 THEN 'Aceita trabalhar nesta praça' END,
           CASE WHEN p.h_nota >= 4.5 THEN format('Nota %s', p.h_nota) END,
           CASE WHEN p.jobs_finalizados >= 3 AND p.faltas = 0 THEN format('%s jobs sem falta', p.jobs_finalizados) END,
           CASE WHEN p.nivel = 3 THEN 'Nível líder na função' WHEN p.nivel = 2 THEN 'Experiente na função' END,
           CASE WHEN p.meios_locomocao && ARRAY['carro_proprio','moto_propria']::meio_locomocao[] THEN 'Tem condução própria' END
         ], NULL),
         array_remove(ARRAY[
           CASE WHEN p.status = 'em_teste' THEN 'Profissional em teste' END,
           CASE WHEN p.cob = 0 THEN 'Não declarou disponibilidade para este horário' END,
           CASE WHEN p.praca_match = 0 THEN 'Fora da praça do evento' END,
           CASE WHEN p.faltas > 0 THEN format('%s falta(s) no histórico', p.faltas) END,
           CASE WHEN p.h_nota IS NOT NULL AND p.h_nota < 3 THEN format('Nota baixa (%s)', p.h_nota) END,
           CASE WHEN p.termina_tarde AND p.meios_locomocao <@ ARRAY['transporte_publico','a_pe']::meio_locomocao[]
                     AND cardinality(p.meios_locomocao) > 0 THEN 'Turno termina tarde e depende de transporte público' END,
           CASE WHEN p.req->'tamanhos_camiseta' IS NOT NULL AND p.tamanho_camiseta IS NOT NULL
                     AND NOT (p.req->'tamanhos_camiseta' ? p.tamanho_camiseta::text)
                THEN format('Sem uniforme no tamanho %s', p.tamanho_camiseta) END,
           CASE WHEN EXISTS (SELECT 1 FROM documento_profissional d WHERE d.profissional_id = p.id
                               AND d.validade IS NOT NULL AND d.validade < p.inicio::date)
                THEN 'Documento vencido na data do evento' END
         ], NULL)
    FROM pontuado p
   ORDER BY 6 DESC, p.h_nota DESC NULLS LAST, p.nome
   LIMIT p_limite
$$;

-- Busca rápida de disponíveis: "quantos <função> livres em <praça> neste intervalo?"
CREATE OR REPLACE FUNCTION profissionais_livres(p_tenant uuid, p_funcao uuid, p_praca uuid,
                                               p_inicio timestamptz, p_fim timestamptz)
RETURNS TABLE (profissional_id uuid, nome text, disponibilidade text, nota_media numeric)
LANGUAGE sql STABLE AS $$
  SELECT pr.id, pr.nome,
         CASE cobertura_disponibilidade(pr.id, p_inicio, p_fim, tn.fuso_horario)
              WHEN 2 THEN 'total' WHEN 1 THEN 'parcial' ELSE 'não declarada' END,
         h.nota_media
    FROM profissional pr
    JOIN tenant tn ON tn.id = pr.tenant_id
    JOIN profissional_funcao pf ON pf.profissional_id = pr.id AND pf.funcao_id = p_funcao
    LEFT JOIN vw_historico_profissional h ON h.profissional_id = pr.id
   WHERE pr.tenant_id = p_tenant AND pr.status = 'ativo'
     AND (pr.praca_base_id = p_praca OR EXISTS (SELECT 1 FROM profissional_praca pp
                                                 WHERE pp.profissional_id = pr.id AND pp.praca_id = p_praca))
     AND NOT EXISTS (SELECT 1 FROM alocacao a WHERE a.profissional_id = pr.id AND a.tipo = 'titular'
                       AND a.status IN ('convidado','confirmado') AND a.periodo && tstzrange(p_inicio, p_fim, '[)'))
     AND NOT EXISTS (SELECT 1 FROM indisponibilidade i WHERE i.profissional_id = pr.id
                       AND i.periodo && tstzrange(p_inicio, p_fim, '[)'))
   ORDER BY cobertura_disponibilidade(pr.id, p_inicio, p_fim, tn.fuso_horario) DESC, h.nota_media DESC NULLS LAST, pr.nome
$$;
