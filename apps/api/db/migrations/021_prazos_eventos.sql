-- =====================================================================
-- 021 — Cores do prazo dos eventos ("shelf life"), por empresa
--
-- Cada evento cai numa faixa conforme a distância até o início:
-- encerrado, hoje, até N dias, de N a M dias, mais de M dias, cancelado.
-- Os limites, as cores e quantos dias de encerrados/cancelados mostrar
-- são configurados no cadastro da empresa. O cálculo é feito na tela.
-- =====================================================================

ALTER TABLE tenant ADD COLUMN prazos_eventos jsonb NOT NULL DEFAULT '{
  "ate_dias": 5,
  "medio_ate_dias": 15,
  "historico_dias": 30,
  "cores": {
    "encerrado": "#1f1d22",
    "hoje": "#f57c00",
    "proximo": "#f2c200",
    "medio": "#2e9d57",
    "distante": "#2f6fdb",
    "cancelado": "#d32f2f"
  }
}'::jsonb;
