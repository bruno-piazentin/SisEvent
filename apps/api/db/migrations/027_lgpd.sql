-- =====================================================================
-- 027 — LGPD: direitos dos titulares, versão do consentimento, exclusão por anonimização
-- e prazo de guarda das inscrições de Casting reprovadas.
-- =====================================================================

-- 1) versão da política aceita junto com o consentimento ---------------------------------
ALTER TABLE inscricao_casting ADD COLUMN versao_politica text;
ALTER TABLE profissional ADD COLUMN versao_politica text;

-- 2) solicitações dos titulares (art. 18 da LGPD) ----------------------------------------
CREATE TYPE tipo_solicitacao_titular AS ENUM (
  'confirmacao_acesso',          -- confirmar se há tratamento e acessar os dados
  'correcao',                    -- corrigir dados incompletos, inexatos ou desatualizados
  'exclusao',                    -- eliminar dados (ou anonimizar)
  'portabilidade',               -- receber os dados em formato estruturado
  'revogacao_consentimento',     -- retirar o consentimento dado
  'informacao_compartilhamento', -- saber com quem os dados são compartilhados
  'oposicao'                     -- opor-se a um tratamento
);
CREATE TYPE status_solicitacao_titular AS ENUM ('aberta', 'em_andamento', 'concluida', 'recusada');

CREATE TABLE solicitacao_titular (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL DEFAULT app_tenant() REFERENCES tenant(id) ON DELETE CASCADE,
  protocolo      text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
  tipo           tipo_solicitacao_titular NOT NULL,
  nome           text NOT NULL CHECK (length(nome) BETWEEN 3 AND 120),
  celular        text CHECK (celular ~ '^\+\d{12,13}$'),
  email          citext CHECK (length(email) <= 254),
  relacao        text NOT NULL CHECK (relacao IN ('profissional', 'candidato_casting', 'contato_cliente', 'usuario', 'outro')),
  descricao      text CHECK (length(descricao) <= 2000),
  status         status_solicitacao_titular NOT NULL DEFAULT 'aberta',
  resposta       text CHECK (length(resposta) <= 4000),
  criada_em      timestamptz NOT NULL DEFAULT now(),
  prazo_em       timestamptz NOT NULL DEFAULT now() + interval '15 days',   -- art. 19, II
  respondida_em  timestamptz,
  respondida_por uuid REFERENCES usuario(id),
  CHECK (celular IS NOT NULL OR email IS NOT NULL)                        -- um canal para responder
);
CREATE INDEX solicitacao_titular_fila_idx ON solicitacao_titular (tenant_id, status, criada_em DESC);
ALTER TABLE solicitacao_titular ENABLE ROW LEVEL SECURITY;
CREATE POLICY isolamento_tenant ON solicitacao_titular TO app_api
  USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());

-- Empresa do formulário público de direitos do titular: qualquer empresa ativa (não depende de módulo)
CREATE FUNCTION titular_empresa(p_slug citext)
RETURNS TABLE (id uuid, nome text, logo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.nome, t.logo FROM tenant t WHERE t.slug = p_slug AND t.ativo;
$$;
REVOKE ALL ON FUNCTION titular_empresa(citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION titular_empresa(citext) TO app_api;

-- 3) exclusão do profissional por anonimização -------------------------------------------
-- Escalas, apontamentos, custos e pagamentos ficam (obrigação legal e defesa da empresa, art. 16),
-- mas sem nada que identifique a pessoa. Apaga fotos, documentos, links de acesso, disponibilidade
-- e as inscrições de Casting dela, e limpa o histórico de alterações (que guardava nome e contato).
-- Roda como dono por causa do histórico (a API não altera a auditoria); confere a empresa do contexto.
CREATE FUNCTION anonimizar_profissional(p_profissional uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid; v_celular text;
BEGIN
  SELECT tenant_id, celular INTO v_tenant, v_celular FROM profissional WHERE id = p_profissional FOR UPDATE;
  IF v_tenant IS NULL OR v_tenant IS DISTINCT FROM app_tenant() THEN
    RAISE EXCEPTION 'Profissional não encontrado' USING ERRCODE = 'P0010';
  END IF;
  IF EXISTS (SELECT 1 FROM pagamento_profissional WHERE profissional_id = p_profissional AND status IN ('pendente', 'em_lote')) THEN
    RAISE EXCEPTION 'Há pagamentos pendentes para esta pessoa: pague ou cancele antes de excluir os dados.' USING ERRCODE = 'P0011';
  END IF;
  IF EXISTS (SELECT 1 FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
              WHERE a.profissional_id = p_profissional AND a.status IN ('convidado', 'confirmado') AND t.fim > now()) THEN
    RAISE EXCEPTION 'A pessoa está escalada em eventos futuros: retire-a da escala antes de excluir os dados.' USING ERRCODE = 'P0011';
  END IF;

  DELETE FROM profissional_foto WHERE profissional_id = p_profissional;
  DELETE FROM documento_profissional WHERE profissional_id = p_profissional;
  DELETE FROM disponibilidade_semanal WHERE profissional_id = p_profissional;
  DELETE FROM profissional_praca WHERE profissional_id = p_profissional;
  DELETE FROM acesso_profissional WHERE profissional_id = p_profissional;
  DELETE FROM inscricao_casting WHERE tenant_id = v_tenant AND (profissional_id = p_profissional OR celular = v_celular);

  UPDATE profissional SET
    nome = 'Titular removido', nome_artistico = NULL, cpf = NULL, cpf_hash = NULL, rg = NULL, data_nascimento = NULL,
    genero = NULL, foto_url = NULL, celular = '+0' || replace(p_profissional::text, '-', ''), email = NULL,
    redes_sociais = '{}'::jsonb, cidade = NULL, uf = NULL, bairro = NULL, cep = NULL, praca_base_id = NULL, raio_km = NULL,
    altura_cm = NULL, peso_kg = NULL, manequim = NULL, tamanho_camiseta = NULL, calcado = NULL, busto_cm = NULL,
    cintura_cm = NULL, quadril_cm = NULL, tipo_cabelo = NULL, cor_cabelo = NULL, cor_olhos = NULL, tom_pele = NULL,
    tatuagem_visivel = NULL, meios_locomocao = '{}', cnh_categoria = NULL, cnh_validade = NULL, idiomas = '{}',
    restricoes_alimentares = NULL, experiencia = NULL, observacoes_internas = NULL, chave_pix = NULL, tipo_chave_pix = NULL,
    banco = NULL, agencia = NULL, conta = NULL, cnpj_mei = NULL, status = 'bloqueado',
    consentimento_lgpd_em = NULL, versao_politica = NULL
   WHERE id = p_profissional;

  -- o histórico guardava nome, contato e medidas: fica só o registro de que houve a anonimização
  DELETE FROM auditoria
   WHERE tenant_id = v_tenant
     AND (registro_id = p_profissional OR alterado ->> 'profissional_id' = p_profissional::text
          OR antes ->> 'profissional_id' = p_profissional::text);
  INSERT INTO auditoria (tenant_id, tabela, registro_id, operacao, usuario_id, motivo, alterado)
  VALUES (v_tenant, 'profissional', p_profissional, 'U', app_usuario(), 'Anonimização a pedido do titular (LGPD)',
          jsonb_build_object('anonimizado', true));
END $$;
REVOKE ALL ON FUNCTION anonimizar_profissional(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION anonimizar_profissional(uuid) TO app_api;

-- 4) prazo de guarda: inscrição reprovada é apagada 180 dias depois da análise ---------------
CREATE FUNCTION limpar_inscricoes_vencidas() RETURNS integer
LANGUAGE sql SECURITY INVOKER AS $$
  WITH apagadas AS (
    DELETE FROM inscricao_casting WHERE status = 'reprovada' AND analisada_em < now() - interval '180 days' RETURNING 1)
  SELECT count(*)::int FROM apagadas;
$$;
