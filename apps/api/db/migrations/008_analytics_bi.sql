-- =====================================================================
-- 008 — Camada analítica (BI) desde o início
--
-- Modelo estrela no schema "analytics", separado do operacional.
-- Hoje: materialized views no mesmo Postgres, atualizadas por job
-- (analytics.atualizar()). Amanhã: o mesmo modelo migra para um warehouse
-- colunar (BigQuery/ClickHouse) sem mudar os painéis — a ferramenta de BI
-- (Metabase) só enxerga este schema, via papel somente leitura.
-- Dados pessoais NÃO entram no BI (sem CPF, celular, endereço).
-- =====================================================================

CREATE SCHEMA analytics;

-- ---------------- Dimensões ----------------

CREATE TABLE analytics.dim_tempo AS
SELECT d::date AS data,
       extract(year FROM d)::int    AS ano,
       extract(month FROM d)::int   AS mes,
       to_char(d, 'YYYY-MM')        AS ano_mes,
       extract(quarter FROM d)::int AS trimestre,
       extract(isodow FROM d)::int  AS dia_semana_iso,
       (ARRAY['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo'])[extract(isodow FROM d)::int] AS nome_dia,
       extract(week FROM d)::int    AS semana_iso,
       extract(isodow FROM d) IN (6,7) AS fim_de_semana
  FROM generate_series('2023-01-01'::date, '2035-12-31'::date, '1 day') d;
ALTER TABLE analytics.dim_tempo ADD PRIMARY KEY (data);

CREATE MATERIALIZED VIEW analytics.dim_praca AS
SELECT id AS praca_id, tenant_id, nome, uf, nome || '/' || uf AS praca FROM praca;
CREATE UNIQUE INDEX ON analytics.dim_praca (praca_id);

CREATE MATERIALIZED VIEW analytics.dim_funcao AS
SELECT id AS funcao_id, tenant_id, codigo, nome FROM funcao;
CREATE UNIQUE INDEX ON analytics.dim_funcao (funcao_id);

CREATE MATERIALIZED VIEW analytics.dim_cliente AS
SELECT c.id AS cliente_id, c.tenant_id, COALESCE(c.nome_fantasia, c.razao_social) AS cliente, c.tipo,
       ag.nome_fantasia AS agencia, c.criado_em::date AS cliente_desde
  FROM cliente c LEFT JOIN cliente ag ON ag.id = c.agencia_id;
CREATE UNIQUE INDEX ON analytics.dim_cliente (cliente_id);

CREATE MATERIALIZED VIEW analytics.dim_profissional AS
SELECT p.id AS profissional_id, p.tenant_id, p.status::text AS status, p.origem::text AS origem, p.genero,
       CASE WHEN p.data_nascimento IS NULL THEN 'não informado'
            WHEN age(p.data_nascimento) < interval '21 years' THEN '18–20'
            WHEN age(p.data_nascimento) < interval '26 years' THEN '21–25'
            WHEN age(p.data_nascimento) < interval '31 years' THEN '26–30'
            WHEN age(p.data_nascimento) < interval '41 years' THEN '31–40'
            ELSE '41+' END AS faixa_etaria,
       p.cidade, p.uf, p.praca_base_id,
       ('carro_proprio' = ANY(p.meios_locomocao) OR 'moto_propria' = ANY(p.meios_locomocao)) AS conducao_propria,
       p.criado_em::date AS cadastrado_em,
       (SELECT string_agg(f.nome, ', ' ORDER BY f.nome) FROM profissional_funcao pf JOIN funcao f ON f.id = pf.funcao_id
         WHERE pf.profissional_id = p.id) AS funcoes
  FROM profissional p;
CREATE UNIQUE INDEX ON analytics.dim_profissional (profissional_id);

CREATE MATERIALIZED VIEW analytics.dim_evento AS
SELECT e.id AS evento_id, e.tenant_id, e.nome AS evento, e.marca, e.status::text AS status,
       e.cliente_id, e.praca_id,
       min(t.inicio)::date AS data_inicio, max(t.fim)::date AS data_fim,
       to_char(min(t.inicio), 'YYYY-MM') AS ano_mes,
       count(DISTINCT t.id) AS turnos, e.clonado_de IS NOT NULL AS clonado
  FROM evento e LEFT JOIN turno t ON t.evento_id = e.id
 WHERE NOT e.is_template
 GROUP BY e.id;
CREATE UNIQUE INDEX ON analytics.dim_evento (evento_id);

-- ---------------- Fatos ----------------

-- Grão: posto (vaga contratada). Mostra demanda, preço e preenchimento.
CREATE MATERIALIZED VIEW analytics.fato_posto AS
SELECT p.id AS posto_id, p.tenant_id, t.evento_id, p.funcao_id, t.inicio::date AS data,
       round(extract(epoch FROM (t.fim - t.inicio)) / 3600.0, 2) AS horas_turno,
       p.quantidade, p.diaria_custo, p.diaria_venda,
       p.quantidade * p.diaria_venda AS receita_prevista,
       p.quantidade * p.diaria_custo AS custo_previsto,
       count(a.id) FILTER (WHERE a.tipo='titular' AND a.status='confirmado') AS confirmados,
       count(a.id) FILTER (WHERE a.tipo='titular' AND a.status IN ('convidado','confirmado','recusado','cancelado','substituido')) AS convites,
       count(a.id) FILTER (WHERE a.status='recusado') AS recusas,
       GREATEST(0, p.quantidade - count(a.id) FILTER (WHERE a.tipo='titular' AND a.status IN ('convidado','confirmado'))) AS vagas_abertas
  FROM posto p JOIN turno t ON t.id = p.turno_id LEFT JOIN alocacao a ON a.posto_id = p.id
 GROUP BY p.id, t.id;
CREATE UNIQUE INDEX ON analytics.fato_posto (posto_id);

-- Grão: alocação (pessoa × turno). Convocação, presença, pontualidade, custo e nota.
CREATE MATERIALIZED VIEW analytics.fato_alocacao AS
SELECT a.id AS alocacao_id, a.tenant_id, t.evento_id, a.posto_id, p.funcao_id, a.profissional_id,
       t.inicio::date AS data, a.tipo::text AS tipo, a.status::text AS status_convocacao,
       round(extract(epoch FROM (a.respondido_em - a.convidado_em)) / 3600.0, 1) AS horas_ate_resposta,
       COALESCE(ap.status::text, CASE WHEN a.status = 'confirmado' AND t.fim < now() THEN 'sem_apontamento' END) AS presenca,
       ap.checkin_metodo, ap.atraso_min, ap.saida_antecipada_min, ap.suspeito,
       (ap.atraso_min > e.tolerancia_atraso_min) AS atrasou,
       c.horas_contratadas, c.horas_trabalhadas, c.minutos_extra, c.minutos_noturnos,
       c.valor_diaria, c.valor_extra, c.valor_noturno, c.valor_descontos, c.valor_adicionais,
       c.valor_total AS custo_total,
       av.nota
  FROM alocacao a
  JOIN posto p ON p.id = a.posto_id
  JOIN turno t ON t.id = p.turno_id
  JOIN evento e ON e.id = t.evento_id
  LEFT JOIN apontamento ap ON ap.alocacao_id = a.id
  LEFT JOIN custo_alocacao c ON c.alocacao_id = a.id
  LEFT JOIN avaliacao av ON av.alocacao_id = a.id
 WHERE NOT e.is_template;
CREATE UNIQUE INDEX ON analytics.fato_alocacao (alocacao_id);
CREATE INDEX ON analytics.fato_alocacao (tenant_id, data);

-- Grão: evento. Resultado financeiro e operacional consolidado.
CREATE MATERIALIZED VIEW analytics.fato_evento AS
SELECT m.evento_id, m.tenant_id, m.cliente_id, m.praca_id, m.inicio::date AS data, m.realizado,
       m.receita, m.custo_equipe, m.custos_diretos,
       m.receita - m.custo_equipe - m.custos_diretos AS margem,
       round(100 * (m.receita - m.custo_equipe - m.custos_diretos) / NULLIF(m.receita, 0), 2) AS margem_pct,
       (SELECT sum(quantidade) FROM analytics.fato_posto fp WHERE fp.evento_id = m.evento_id) AS efetivo_previsto,
       (SELECT count(*) FROM analytics.fato_alocacao fa WHERE fa.evento_id = m.evento_id AND fa.presenca = 'presente') AS efetivo_realizado,
       (SELECT count(*) FROM analytics.fato_alocacao fa WHERE fa.evento_id = m.evento_id AND fa.presenca = 'falta') AS faltas,
       (SELECT count(*) FROM ocorrencia o WHERE o.evento_id = m.evento_id) AS ocorrencias
  FROM vw_margem_evento m
  JOIN evento e ON e.id = m.evento_id
 WHERE NOT e.is_template AND e.status <> 'cancelado';
CREATE UNIQUE INDEX ON analytics.fato_evento (evento_id);

-- ---------------- Indicadores prontos (base dos painéis) ----------------

CREATE VIEW analytics.kpi_mensal AS
SELECT fe.tenant_id, dt.ano_mes,
       count(*)                          AS eventos,
       count(*) FILTER (WHERE realizado) AS eventos_fechados,
       sum(receita)                      AS receita,
       sum(custo_equipe)                 AS custo_equipe,
       sum(custos_diretos)               AS custos_diretos,
       sum(margem)                       AS margem,
       round(100 * sum(margem) / NULLIF(sum(receita), 0), 2) AS margem_pct,
       sum(efetivo_previsto)             AS efetivo_previsto,
       sum(efetivo_realizado)            AS efetivo_realizado,
       round(100.0 * sum(faltas) / NULLIF(sum(efetivo_realizado) + sum(faltas), 0), 2) AS taxa_falta_pct
  FROM analytics.fato_evento fe JOIN analytics.dim_tempo dt ON dt.data = fe.data
 GROUP BY fe.tenant_id, dt.ano_mes;

CREATE VIEW analytics.kpi_cliente AS
SELECT fe.tenant_id, dc.cliente_id, dc.cliente, count(*) AS eventos,
       sum(fe.receita) AS receita, sum(fe.margem) AS margem,
       round(100 * sum(fe.margem) / NULLIF(sum(fe.receita), 0), 2) AS margem_pct,
       max(fe.data) AS ultimo_evento
  FROM analytics.fato_evento fe JOIN analytics.dim_cliente dc ON dc.cliente_id = fe.cliente_id
 GROUP BY fe.tenant_id, dc.cliente_id, dc.cliente;

CREATE VIEW analytics.kpi_profissional AS
SELECT fa.tenant_id, fa.profissional_id, dp.funcoes, dp.faixa_etaria, dp.cidade,
       count(*) FILTER (WHERE fa.presenca IN ('presente','falta')) AS jobs,
       count(*) FILTER (WHERE fa.presenca = 'presente') AS presencas,
       count(*) FILTER (WHERE fa.presenca = 'falta') AS faltas,
       count(*) FILTER (WHERE fa.atrasou) AS atrasos,
       round(100.0 * count(*) FILTER (WHERE fa.presenca = 'presente')
             / NULLIF(count(*) FILTER (WHERE fa.presenca IN ('presente','falta')), 0), 1) AS assiduidade_pct,
       round(avg(fa.nota), 2) AS nota_media,
       round(avg(fa.horas_ate_resposta), 1) AS horas_media_resposta,
       sum(fa.custo_total) AS total_recebido
  FROM analytics.fato_alocacao fa JOIN analytics.dim_profissional dp ON dp.profissional_id = fa.profissional_id
 WHERE fa.tipo = 'titular'
 GROUP BY fa.tenant_id, fa.profissional_id, dp.funcoes, dp.faixa_etaria, dp.cidade;

-- Ocupação da base: quantos profissionais ativos trabalharam no mês
CREATE VIEW analytics.kpi_ocupacao_base AS
SELECT dp.tenant_id, dt.ano_mes,
       count(DISTINCT dp.profissional_id) FILTER (WHERE dp.status = 'ativo') AS base_ativa,
       count(DISTINCT fa.profissional_id) FILTER (WHERE fa.presenca = 'presente') AS trabalharam,
       round(100.0 * count(DISTINCT fa.profissional_id) FILTER (WHERE fa.presenca = 'presente')
             / NULLIF(count(DISTINCT dp.profissional_id) FILTER (WHERE dp.status = 'ativo'), 0), 1) AS ocupacao_pct
  FROM analytics.dim_profissional dp
  CROSS JOIN (SELECT DISTINCT ano_mes FROM analytics.fato_alocacao fa JOIN analytics.dim_tempo t ON t.data = fa.data) dt
  LEFT JOIN analytics.fato_alocacao fa ON fa.profissional_id = dp.profissional_id
        AND to_char(fa.data, 'YYYY-MM') = dt.ano_mes
 GROUP BY dp.tenant_id, dt.ano_mes;

-- ---------------- Atualização ----------------

CREATE TABLE analytics.atualizacao_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  iniciado_em timestamptz NOT NULL DEFAULT now(),
  concluido_em timestamptz,
  duracao_ms  integer
);

-- Ordem importa: fato_evento depende de fato_posto e fato_alocacao
CREATE OR REPLACE FUNCTION analytics.atualizar(p_concorrente boolean DEFAULT true) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE v_id bigint; v_ini timestamptz := clock_timestamp(); mv text;
BEGIN
  INSERT INTO analytics.atualizacao_log DEFAULT VALUES RETURNING id INTO v_id;
  FOREACH mv IN ARRAY ARRAY['dim_praca','dim_funcao','dim_cliente','dim_profissional','dim_evento',
                            'fato_posto','fato_alocacao','fato_evento'] LOOP
    IF p_concorrente THEN
      EXECUTE format('REFRESH MATERIALIZED VIEW CONCURRENTLY analytics.%I', mv);
    ELSE
      EXECUTE format('REFRESH MATERIALIZED VIEW analytics.%I', mv);
    END IF;
  END LOOP;
  UPDATE analytics.atualizacao_log SET concluido_em = clock_timestamp(),
         duracao_ms = extract(milliseconds FROM clock_timestamp() - v_ini)::int WHERE id = v_id;
END $$;

-- ---------------- Papel somente leitura para a ferramenta de BI ----------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_leitor') THEN
    CREATE ROLE bi_leitor NOLOGIN;
  END IF;
END $$;
GRANT USAGE ON SCHEMA analytics TO bi_leitor;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO bi_leitor;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO bi_leitor;
-- Usuário de login do Metabase (senha definida no deploy):
--   CREATE ROLE metabase LOGIN PASSWORD '...' IN ROLE bi_leitor;
