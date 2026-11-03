-- =====================================================================
-- 023 — Segurança do acesso e dos dados pessoais
--
-- 1) Permissão "DP · Dados pessoais": quem não tem não vê (nem altera) CPF,
--    RG, nascimento e dados bancários de profissionais nem o CPF de clientes.
--    Fica sempre liberada para a empresa; quem decide é o perfil e o ajuste
--    por usuário. A administradora (acesso total) e o master veem.
-- 2) Login: 5 senhas erradas seguidas bloqueiam o usuário por 15 minutos.
-- 3) Sessões revogáveis: redefinir a senha ou inativar derruba as sessões abertas.
-- 4) CPF, RG e dados bancários do profissional passam a ser gravados
--    criptografados pela API (AES-256-GCM). O CPF continua único pela
--    impressão digital (HMAC) em cpf_hash. Os dados já gravados são
--    criptografados pelo script `npm run cifrar-dados`.
-- 5) A auditoria não guarda mais esses valores (registra só que mudaram)
--    e o histórico antigo é mascarado.
-- =====================================================================

-- 1) permissão de dados pessoais -------------------------------------------
INSERT INTO modulo (codigo, nome, descricao, fase, ordem) VALUES
 ('DP', 'Dados pessoais', 'Ver e alterar CPF, RG, nascimento e dados bancários de profissionais e o CPF de clientes', 1, 11);

INSERT INTO modulo_liberado (tenant_id, modulo) SELECT id, 'DP' FROM tenant
ON CONFLICT (tenant_id, modulo) DO UPDATE SET ativo = true, expira_em = NULL;

-- o Financeiro precisa da chave PIX para pagar; os demais perfis só com liberação
INSERT INTO perfil_permissao (perfil_id, modulo, acao)
SELECT id, 'DP', 'ver' FROM perfil_acesso WHERE codigo = 'financeiro'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION criar_perfis_padrao(p_tenant uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_central uuid; v_sup uuid; v_fin uuid;
BEGIN
  INSERT INTO perfil_acesso (tenant_id, codigo, nome, acesso_total)
       VALUES (p_tenant,'admin','Administradora',true);

  INSERT INTO perfil_acesso (tenant_id, codigo, nome) VALUES (p_tenant,'central','Central / coordenação')
  RETURNING id INTO v_central;
  INSERT INTO perfil_acesso (tenant_id, codigo, nome) VALUES (p_tenant,'supervisor','Supervisor de campo')
  RETURNING id INTO v_sup;
  INSERT INTO perfil_acesso (tenant_id, codigo, nome) VALUES (p_tenant,'financeiro','Financeiro')
  RETURNING id INTO v_fin;

  -- Central: eventos, escalas, profissionais, ocorrências — SEM valores/margem
  INSERT INTO perfil_permissao (perfil_id, modulo, acao)
  SELECT v_central, m, a::acao_permissao
    FROM unnest(ARRAY['M1','M2','M3','M4','M5','M6','M8']) m,
         unnest(ARRAY['ver','criar','editar','aprovar']) a;
  INSERT INTO perfil_permissao VALUES (v_central,'M9','ver');

  -- Supervisor: apenas campo (o recorte "só o seu evento" é aplicado por evento_supervisor)
  INSERT INTO perfil_permissao (perfil_id, modulo, acao) VALUES
    (v_sup,'M4','ver'), (v_sup,'M5','ver'),
    (v_sup,'M6','ver'), (v_sup,'M6','criar'), (v_sup,'M6','editar'),
    (v_sup,'M8','ver'), (v_sup,'M8','criar');

  -- Financeiro: pagar/receber e valores, sem edição de escala; vê a chave PIX (dados pessoais)
  INSERT INTO perfil_permissao (perfil_id, modulo, acao)
  SELECT v_fin, 'M7', a::acao_permissao FROM unnest(ARRAY['ver','criar','editar','aprovar','ver_valores']) a;
  INSERT INTO perfil_permissao (perfil_id, modulo, acao) VALUES
    (v_fin,'M4','ver'), (v_fin,'M5','ver'), (v_fin,'M3','ver'), (v_fin,'M3','ver_valores'),
    (v_fin,'M9','ver'), (v_fin,'M9','ver_valores'), (v_fin,'BI','ver'), (v_fin,'BI','ver_valores'),
    (v_fin,'DP','ver');
END $$;

-- 2) e 3) bloqueio de login e sessões revogáveis ----------------------------
ALTER TABLE usuario
  ADD COLUMN falhas_login  smallint NOT NULL DEFAULT 0,
  ADD COLUMN bloqueado_ate timestamptz,
  ADD COLUMN sessoes_desde timestamptz;   -- sessões emitidas antes disso não valem mais

DROP FUNCTION buscar_usuario_login(citext, citext);
CREATE FUNCTION buscar_usuario_login(p_email citext, p_tenant_slug citext)
RETURNS TABLE (id uuid, tenant_id uuid, nome text, senha_hash text, ativo boolean, perfil text, bloqueado_ate timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.tenant_id, u.nome, u.senha_hash, u.ativo AND t.ativo, p.codigo,
         CASE WHEN u.bloqueado_ate > now() THEN u.bloqueado_ate END
    FROM usuario u JOIN tenant t ON t.id = u.tenant_id JOIN perfil_acesso p ON p.id = u.perfil_id
   WHERE u.email = p_email AND t.slug = p_tenant_slug
$$;
REVOKE ALL ON FUNCTION buscar_usuario_login(citext, citext) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buscar_usuario_login(citext, citext) TO app_api;

-- Resultado da tentativa: acerto zera o contador; a 5ª falha seguida bloqueia por 15 minutos.
-- Devolve até quando o usuário ficou bloqueado (ou NULL).
CREATE FUNCTION registrar_tentativa_login(p_usuario uuid, p_ok boolean) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ate timestamptz;
BEGIN
  IF p_ok THEN
    UPDATE usuario SET falhas_login = 0, bloqueado_ate = NULL, ultimo_acesso = now() WHERE id = p_usuario;
    RETURN NULL;
  END IF;
  UPDATE usuario
     SET falhas_login  = CASE WHEN falhas_login + 1 >= 5 THEN 0 ELSE falhas_login + 1 END,
         bloqueado_ate = CASE WHEN falhas_login + 1 >= 5 THEN now() + interval '15 minutes' ELSE bloqueado_ate END
   WHERE id = p_usuario
  RETURNING CASE WHEN bloqueado_ate > now() THEN bloqueado_ate END INTO v_ate;
  RETURN v_ate;
END $$;
REVOKE ALL ON FUNCTION registrar_tentativa_login(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION registrar_tentativa_login(uuid, boolean) TO app_api;

-- 4) CPF único pela impressão digital (o valor gravado é criptografado) -----
ALTER TABLE profissional ADD COLUMN cpf_hash text;
ALTER TABLE profissional DROP CONSTRAINT profissional_tenant_id_cpf_key;
ALTER TABLE profissional ADD CONSTRAINT profissional_cpf_unico UNIQUE (tenant_id, cpf_hash);

-- 5) auditoria sem dados pessoais -------------------------------------------
CREATE FUNCTION mascarar_sensiveis(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN j IS NULL OR jsonb_typeof(j) <> 'object' THEN j ELSE
    j || COALESCE((SELECT jsonb_object_agg(e.key, to_jsonb('***'::text)) FROM jsonb_each(j) e
                    WHERE e.key = ANY (ARRAY['cpf','cpf_hash','rg','data_nascimento','chave_pix','tipo_chave_pix',
                                             'banco','agencia','conta','cnpj_mei'])
                      AND e.value <> 'null'::jsonb), '{}'::jsonb) END
$$;

CREATE OR REPLACE FUNCTION trg_auditar() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_new jsonb; v_old jsonb; v_diff jsonb; v_reg uuid;
BEGIN
  v_new := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END;
  v_old := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END;

  -- segredos e campos técnicos não vão para a auditoria
  v_new := v_new - ARRAY['senha_hash','totp_segredo','qr_segredo','token_hash','atualizado_em','falhas_login'];
  v_old := v_old - ARRAY['senha_hash','totp_segredo','qr_segredo','token_hash','atualizado_em','falhas_login'];

  IF TG_OP = 'UPDATE' THEN
    SELECT jsonb_object_agg(n.key, n.value) INTO v_diff
      FROM jsonb_each(v_new) n
     WHERE v_old -> n.key IS DISTINCT FROM n.value;
    IF v_diff IS NULL THEN RETURN NEW; END IF;   -- nada mudou de fato
    v_old := (SELECT jsonb_object_agg(k, v_old -> k) FROM jsonb_object_keys(v_diff) k);
  ELSE
    v_diff := COALESCE(v_new, v_old);
    IF TG_OP = 'INSERT' THEN v_old := NULL; END IF;
  END IF;

  -- dados pessoais: fica registrado que mudou, nunca o valor
  v_diff := mascarar_sensiveis(v_diff);
  v_old  := mascarar_sensiveis(v_old);

  v_reg := COALESCE(v_new ->> 'id', v_old ->> 'id', v_new ->> 'alocacao_id', v_old ->> 'alocacao_id')::uuid;

  INSERT INTO auditoria (tenant_id, tabela, registro_id, operacao, usuario_id, motivo, alterado, antes)
  VALUES (COALESCE((v_new ->> 'tenant_id')::uuid, (to_jsonb(OLD) ->> 'tenant_id')::uuid),
          TG_TABLE_NAME, v_reg, left(TG_OP, 1), app_usuario(),
          NULLIF(current_setting('app.motivo', true), ''), v_diff,
          CASE WHEN TG_OP = 'UPDATE' THEN v_old WHEN TG_OP = 'DELETE' THEN v_old END);
  RETURN COALESCE(NEW, OLD);
END $$;

UPDATE auditoria SET alterado = mascarar_sensiveis(alterado), antes = mascarar_sensiveis(antes)
 WHERE alterado ?| ARRAY['cpf','rg','data_nascimento','chave_pix','tipo_chave_pix','banco','agencia','conta','cnpj_mei']
    OR antes    ?| ARRAY['cpf','rg','data_nascimento','chave_pix','tipo_chave_pix','banco','agencia','conta','cnpj_mei'];
