-- =====================================================================
-- 024 — Bloqueio por senha errada também para o usuário master
--
-- O master não é um usuário de uma empresa só (entra em todas), então o
-- bloqueio da 023 (colunas em usuario) não vale para ele. Aqui o contador
-- fica numa tabela à parte, por chave ('master'), com a mesma regra:
-- 5 senhas erradas seguidas bloqueiam por 15 minutos, em todos os servidores.
-- A tabela não tem acesso direto pela API: só pelas duas funções abaixo.
-- =====================================================================

CREATE TABLE bloqueio_login (
  chave         text PRIMARY KEY,
  falhas        smallint NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  ultima_falha  timestamptz
);
REVOKE ALL ON bloqueio_login FROM PUBLIC;

-- até quando a chave está bloqueada (NULL = liberada)
CREATE FUNCTION bloqueio_login_ate(p_chave text) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT bloqueado_ate FROM bloqueio_login WHERE chave = p_chave AND bloqueado_ate > now()
$$;

-- registra o resultado da tentativa; devolve até quando ficou bloqueada (NULL = não bloqueou)
CREATE FUNCTION registrar_tentativa_chave(p_chave text, p_ok boolean) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ate timestamptz;
BEGIN
  IF p_ok THEN
    DELETE FROM bloqueio_login WHERE chave = p_chave;
    RETURN NULL;
  END IF;
  INSERT INTO bloqueio_login (chave, falhas, ultima_falha) VALUES (p_chave, 1, now())
  ON CONFLICT (chave) DO UPDATE
     -- erros espaçados (mais de 15 minutos) recomeçam a contagem
     SET falhas        = CASE WHEN bloqueio_login.ultima_falha < now() - interval '15 minutes' THEN 1
                              WHEN bloqueio_login.falhas + 1 >= 5 THEN 0 ELSE bloqueio_login.falhas + 1 END,
         bloqueado_ate = CASE WHEN bloqueio_login.ultima_falha >= now() - interval '15 minutes' AND bloqueio_login.falhas + 1 >= 5
                              THEN now() + interval '15 minutes' ELSE bloqueio_login.bloqueado_ate END,
         ultima_falha  = now()
  RETURNING CASE WHEN bloqueado_ate > now() THEN bloqueado_ate END INTO v_ate;
  RETURN v_ate;
END $$;

REVOKE ALL ON FUNCTION bloqueio_login_ate(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION registrar_tentativa_chave(text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION bloqueio_login_ate(text) TO app_api;
GRANT EXECUTE ON FUNCTION registrar_tentativa_chave(text, boolean) TO app_api;
