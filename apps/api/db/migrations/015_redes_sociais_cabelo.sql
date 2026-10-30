-- =====================================================================
-- 015 — Redes sociais (cliente e profissional) e cabelo do profissional
--
-- * redes_sociais jsonb: {"instagram": "@x", "tiktok": "...", "facebook": "...",
--   "linkedin": "...", "youtube": "...", "x": "...", "site": "..."}
--   O antigo profissional.instagram é migrado para cá e a coluna sai.
-- * tipo_cabelo e cor_cabelo com valores padronizados — permitem filtrar
--   ("ruivas", "cacheados") e viram requisito do posto no cruzamento.
--   Valores livres antigos de cor_cabelo que não se encaixam vão para as
--   observações internas, para ninguém perder a informação.
-- =====================================================================

ALTER TABLE cliente      ADD COLUMN redes_sociais jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE profissional ADD COLUMN redes_sociais jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE profissional SET redes_sociais = jsonb_build_object('instagram', trim(instagram))
 WHERE instagram IS NOT NULL AND trim(instagram) <> '';
ALTER TABLE profissional DROP COLUMN instagram;

-- cabelo: tipo (curvatura) e cor
ALTER TABLE profissional ADD COLUMN tipo_cabelo text
  CHECK (tipo_cabelo IN ('liso','ondulado','cacheado','crespo','raspado'));

UPDATE profissional SET cor_cabelo = CASE
    WHEN normalizar_busca(cor_cabelo) ~ 'ruiv|ruiva|acobread|cobre'        THEN 'ruivo'
    WHEN normalizar_busca(cor_cabelo) ~ 'loir|platinad|dourad'              THEN 'loiro'
    WHEN normalizar_busca(cor_cabelo) ~ 'castanh|moren'                    THEN 'castanho'
    WHEN normalizar_busca(cor_cabelo) ~ 'pret|negr'                        THEN 'preto'
    WHEN normalizar_busca(cor_cabelo) ~ 'grisalh|branc|cinza|prata'         THEN 'grisalho'
    WHEN normalizar_busca(cor_cabelo) ~ 'colorid|azul|rosa|roxo|verde|fantasia' THEN 'colorido'
    ELSE cor_cabelo END
 WHERE cor_cabelo IS NOT NULL;
UPDATE profissional
   SET observacoes_internas = concat_ws(E'\n', observacoes_internas, 'Cabelo (cadastro antigo): ' || cor_cabelo),
       cor_cabelo = NULL
 WHERE cor_cabelo IS NOT NULL AND cor_cabelo NOT IN ('preto','castanho','loiro','ruivo','grisalho','colorido');
ALTER TABLE profissional ADD CONSTRAINT profissional_cor_cabelo_check
  CHECK (cor_cabelo IN ('preto','castanho','loiro','ruivo','grisalho','colorido'));

CREATE INDEX profissional_cabelo_idx ON profissional (tenant_id, cor_cabelo, tipo_cabelo);

-- ---------------------------------------------------------------------
-- Cruzamento: requisitos do posto ganham cabelo_tipos e cabelo_cores
-- (listas; vazio ou ausente = qualquer). Restante igual à 006.
-- ---------------------------------------------------------------------
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
       AND NOT EXISTS (SELECT 1 FROM alocacao a WHERE a.posto_id = ctx.posto_id AND a.profissional_id = pr.id
                         AND a.status IN ('convidado','confirmado'))
       AND NOT EXISTS (SELECT 1 FROM alocacao a WHERE a.profissional_id = pr.id AND a.tipo = 'titular'
                         AND a.status IN ('convidado','confirmado')
                         AND a.periodo && tstzrange(ctx.inicio, ctx.fim, '[)'))
       AND NOT EXISTS (SELECT 1 FROM indisponibilidade i WHERE i.profissional_id = pr.id
                         AND i.periodo && tstzrange(ctx.inicio, ctx.fim, '[)'))
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
       -- cabelo (ex.: posto pede ruivas ou cacheados)
       AND (ctx.req->'cabelo_tipos' IS NULL OR jsonb_array_length(ctx.req->'cabelo_tipos') = 0
            OR pr.tipo_cabelo IN (SELECT jsonb_array_elements_text(ctx.req->'cabelo_tipos')))
       AND (ctx.req->'cabelo_cores' IS NULL OR jsonb_array_length(ctx.req->'cabelo_cores') = 0
            OR pr.cor_cabelo IN (SELECT jsonb_array_elements_text(ctx.req->'cabelo_cores')))
  ),
  pontuado AS (
    SELECT c.*,
      (CASE c.cob WHEN 2 THEN 30 WHEN 1 THEN 12 ELSE 0 END)
      + (CASE c.praca_match WHEN 2 THEN 20 WHEN 1 THEN 14 ELSE 0 END)
      + COALESCE(round(c.h_nota / 5.0 * 20), 10)
      + CASE WHEN COALESCE(c.jobs_finalizados, 0) = 0 THEN 9
             ELSE round(15.0 * c.presencas / c.jobs_finalizados) END
      + (c.nivel - 1) * 5
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
           CASE WHEN p.meios_locomocao && ARRAY['carro_proprio','moto_propria']::meio_locomocao[] THEN 'Tem condução própria' END,
           CASE WHEN jsonb_array_length(COALESCE(p.req->'cabelo_tipos', '[]')) + jsonb_array_length(COALESCE(p.req->'cabelo_cores', '[]')) > 0
                THEN 'Cabelo no perfil pedido' END
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
