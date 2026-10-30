-- =====================================================================
-- Dados de demonstração — Rafa Dutra Eventos
-- Senha de todos os usuários de demonstração: sisevent123  (troque em produção)
-- =====================================================================
BEGIN;

INSERT INTO tenant (id, nome, slug) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Rafa Dutra Eventos', 'rafadutra');

SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000001', true);

SELECT criar_perfis_padrao('00000000-0000-0000-0000-000000000001');

-- Módulos liberados: Fase 1 + BI + check-in (M6). M2, M8 e M9 ficam bloqueados até a liberação.
INSERT INTO modulo_liberado (tenant_id, modulo)
SELECT '00000000-0000-0000-0000-000000000001', m FROM unnest(ARRAY['M1','M3','M4','M5','M6','M7','BI']) m;

INSERT INTO regra_custo (tenant_id) VALUES ('00000000-0000-0000-0000-000000000001');

INSERT INTO usuario (id, tenant_id, perfil_id, nome, email, senha_hash)
SELECT v.id::uuid, '00000000-0000-0000-0000-000000000001', p.id, v.nome, v.email, crypt('sisevent123', gen_salt('bf', 10))
  FROM (VALUES
    ('10000000-0000-0000-0000-000000000001','admin','Rafa Dutra','rafa@rafadutra.com.br'),
    ('10000000-0000-0000-0000-000000000002','central','Camila (Central)','central@rafadutra.com.br'),
    ('10000000-0000-0000-0000-000000000003','supervisor','Diego (Supervisor)','supervisor@rafadutra.com.br'),
    ('10000000-0000-0000-0000-000000000004','financeiro','Fernanda (Financeiro)','financeiro@rafadutra.com.br')
  ) v(id, perfil, nome, email)
  JOIN perfil_acesso p ON p.codigo = v.perfil AND p.tenant_id = '00000000-0000-0000-0000-000000000001';

INSERT INTO praca (id, nome, uf) VALUES
  ('20000000-0000-0000-0000-000000000001','Londrina','PR'),
  ('20000000-0000-0000-0000-000000000002','Maringá','PR'),
  ('20000000-0000-0000-0000-000000000003','Curitiba','PR');

INSERT INTO funcao (id, codigo, nome) VALUES
  ('30000000-0000-0000-0000-000000000001','promotor','Promotor(a)'),
  ('30000000-0000-0000-0000-000000000002','recepcionista','Recepcionista'),
  ('30000000-0000-0000-0000-000000000003','hostess','Hostess'),
  ('30000000-0000-0000-0000-000000000004','degustacao','Degustação'),
  ('30000000-0000-0000-0000-000000000005','captador','Captador(a) de leads'),
  ('30000000-0000-0000-0000-000000000006','staff','Staff de produção'),
  ('30000000-0000-0000-0000-000000000007','montagem','Montagem'),
  ('30000000-0000-0000-0000-000000000008','modelo','Modelo');

-- Profissionais (dados fictícios)
INSERT INTO profissional (id, nome, celular, email, data_nascimento, genero, cidade, uf, praca_base_id, altura_cm,
                          manequim, tamanho_camiseta, calcado, meios_locomocao, cnh_categoria, idiomas, status,
                          chave_pix, forma_contratacao, consentimento_lgpd_em)
VALUES
 ('40000000-0000-0000-0000-000000000001','Ana Beatriz Souza','+5543991110001','ana@ex.com','2000-03-12','feminino','Londrina','PR','20000000-0000-0000-0000-000000000001',168,38,'M',37,'{carro_proprio}','B','{português,inglês}','ativo','ana@ex.com','mei',now()),
 ('40000000-0000-0000-0000-000000000002','Bruno Henrique Lima','+5543991110002','bruno@ex.com','1998-07-01','masculino','Londrina','PR','20000000-0000-0000-0000-000000000001',182,42,'G',42,'{moto_propria}','A','{português}','ativo','43991110002','autonomo',now()),
 ('40000000-0000-0000-0000-000000000003','Carla Mendes','+5543991110003','carla@ex.com','2002-11-20','feminino','Londrina','PR','20000000-0000-0000-0000-000000000001',172,36,'P',36,'{transporte_publico}',NULL,'{português,espanhol}','ativo','carla@ex.com','autonomo',now()),
 ('40000000-0000-0000-0000-000000000004','Daniel Oliveira','+5543991110004','daniel@ex.com','1995-01-30','masculino','Cambé','PR','20000000-0000-0000-0000-000000000001',176,40,'M',41,'{carro_proprio}','B','{português}','ativo','daniel@ex.com','mei',now()),
 ('40000000-0000-0000-0000-000000000005','Eduarda Rocha','+5543991110005','duda@ex.com','2001-05-08','feminino','Londrina','PR','20000000-0000-0000-0000-000000000001',165,38,'M',36,'{aplicativo,transporte_publico}',NULL,'{português}','ativo','duda@ex.com','autonomo',now()),
 ('40000000-0000-0000-0000-000000000006','Felipe Arantes','+5544991110006','felipe@ex.com','1999-09-15','masculino','Maringá','PR','20000000-0000-0000-0000-000000000002',185,44,'G',43,'{carro_proprio}','AB','{português,inglês}','ativo','felipe@ex.com','mei',now()),
 ('40000000-0000-0000-0000-000000000007','Gabriela Torres','+5544991110007','gabi@ex.com','2003-02-22','feminino','Maringá','PR','20000000-0000-0000-0000-000000000002',174,36,'P',37,'{transporte_publico}',NULL,'{português}','em_teste','gabi@ex.com','autonomo',now()),
 ('40000000-0000-0000-0000-000000000008','Heloísa Prado','+5544991110008','helo@ex.com','1997-12-03','feminino','Maringá','PR','20000000-0000-0000-0000-000000000002',170,40,'M',38,'{carro_proprio}','B','{português,inglês,espanhol}','ativo','helo@ex.com','mei',now()),
 ('40000000-0000-0000-0000-000000000009','Igor Nascimento','+5543991110009','igor@ex.com','2000-08-19','masculino','Londrina','PR','20000000-0000-0000-0000-000000000001',179,42,'G',42,'{bicicleta,transporte_publico}',NULL,'{português}','ativo','igor@ex.com','autonomo',now()),
 ('40000000-0000-0000-0000-000000000010','Juliana Castro','+5543991110010','ju@ex.com','1996-04-11','feminino','Londrina','PR','20000000-0000-0000-0000-000000000001',177,38,'M',39,'{carro_proprio}','B','{português,inglês}','ativo','ju@ex.com','mei',now()),
 ('40000000-0000-0000-0000-000000000011','Kauã Ribeiro','+5543991110011','kaua@ex.com','2004-06-25','masculino','Londrina','PR','20000000-0000-0000-0000-000000000001',173,40,'M',41,'{transporte_publico}',NULL,'{português}','bloqueado','kaua@ex.com','autonomo',now()),
 ('40000000-0000-0000-0000-000000000012','Larissa Moura','+5544991110012','lari@ex.com','1999-10-02','feminino','Sarandi','PR','20000000-0000-0000-0000-000000000002',169,38,'M',37,'{moto_propria}','A','{português}','ativo','lari@ex.com','autonomo',now());

INSERT INTO profissional_funcao (profissional_id, funcao_id, nivel) VALUES
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',3),
 ('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003',2),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',2),
 ('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000006',2),
 ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000001',1),
 ('40000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000002',2),
 ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000001',2),
 ('40000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000007',3),
 ('40000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000001',1),
 ('40000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000004',2),
 ('40000000-0000-0000-0000-000000000006','30000000-0000-0000-0000-000000000001',2),
 ('40000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000001',1),
 ('40000000-0000-0000-0000-000000000007','30000000-0000-0000-0000-000000000008',1),
 ('40000000-0000-0000-0000-000000000008','30000000-0000-0000-0000-000000000001',3),
 ('40000000-0000-0000-0000-000000000008','30000000-0000-0000-0000-000000000002',3),
 ('40000000-0000-0000-0000-000000000009','30000000-0000-0000-0000-000000000001',1),
 ('40000000-0000-0000-0000-000000000009','30000000-0000-0000-0000-000000000005',2),
 ('40000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000001',2),
 ('40000000-0000-0000-0000-000000000010','30000000-0000-0000-0000-000000000003',3),
 ('40000000-0000-0000-0000-000000000011','30000000-0000-0000-0000-000000000001',1),
 ('40000000-0000-0000-0000-000000000012','30000000-0000-0000-0000-000000000001',2),
 ('40000000-0000-0000-0000-000000000012','30000000-0000-0000-0000-000000000005',2);

-- Quem aceita trabalhar fora da base
INSERT INTO profissional_praca VALUES
 ('40000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'),
 ('40000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002'),
 ('40000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000010','20000000-0000-0000-0000-000000000002');

-- Disponibilidade semanal (0=domingo .. 6=sábado)
INSERT INTO disponibilidade_semanal (profissional_id, dia_semana, hora_inicio, hora_fim)
SELECT p::uuid, d, hi::time, hf::time FROM (VALUES
  ('40000000-0000-0000-0000-000000000001', ARRAY[5,6,0], '08:00','23:59'),
  ('40000000-0000-0000-0000-000000000002', ARRAY[6,0],   '10:00','22:00'),
  ('40000000-0000-0000-0000-000000000003', ARRAY[6],     '13:00','19:00'),
  ('40000000-0000-0000-0000-000000000004', ARRAY[1,2,3,4,5,6,0], '07:00','23:00'),
  ('40000000-0000-0000-0000-000000000005', ARRAY[6,0],   '09:00','18:00'),
  ('40000000-0000-0000-0000-000000000006', ARRAY[5,6],   '14:00','02:00'),
  ('40000000-0000-0000-0000-000000000007', ARRAY[6,0],   '10:00','22:00'),
  ('40000000-0000-0000-0000-000000000008', ARRAY[4,5,6,0], '10:00','23:00'),
  ('40000000-0000-0000-0000-000000000009', ARRAY[6],     '08:00','14:00'),
  ('40000000-0000-0000-0000-000000000010', ARRAY[5,6,0], '09:00','23:00'),
  ('40000000-0000-0000-0000-000000000012', ARRAY[6,0],   '12:00','23:00')
) v(p, dias, hi, hf), unnest(v.dias) d;

INSERT INTO documento_profissional (profissional_id, tipo, arquivo_url, validade) VALUES
 ('40000000-0000-0000-0000-000000000005','manipulacao_alimentos','s3://docs/duda-manip.pdf', current_date + 12),
 ('40000000-0000-0000-0000-000000000002','cnh','s3://docs/bruno-cnh.pdf', current_date - 5);

-- Clientes
INSERT INTO cliente (id, razao_social, nome_fantasia, cnpj, tipo, cor_primaria, prazo_pagamento_dias) VALUES
 ('50000000-0000-0000-0000-000000000001','Agência Norte Live Marketing Ltda','Norte Live','11222333000144','agencia','#1f2937',30),
 ('50000000-0000-0000-0000-000000000002','Cervejaria Café Colonial S.A.','Colonial','55666777000188','outro','#b45309',45);
UPDATE cliente SET agencia_id = '50000000-0000-0000-0000-000000000001' WHERE id = '50000000-0000-0000-0000-000000000002';

-- Marcas que cada cliente representa
INSERT INTO marca (id, nome) VALUES
 ('51000000-0000-0000-0000-000000000001','Colonial'),
 ('51000000-0000-0000-0000-000000000002','Colonial Lager');
INSERT INTO cliente_marca (cliente_id, marca_id) VALUES
 ('50000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000001'),
 ('50000000-0000-0000-0000-000000000002','51000000-0000-0000-0000-000000000002');

INSERT INTO fornecedor (nome, categoria) VALUES ('Uniformes Paraná','uniforme'), ('Van Express Londrina','transporte');

-- Eventos no próximo sábado (datas relativas para a demonstração sempre funcionar)
WITH sab AS (SELECT (current_date + ((6 - extract(dow FROM current_date)::int + 7) % 7))::date AS d)
INSERT INTO evento (id, cliente_id, praca_id, nome, marca, local_nome, endereco, latitude, longitude, status, metas, requisitos)
SELECT '60000000-0000-0000-0000-000000000001'::uuid,'50000000-0000-0000-0000-000000000002'::uuid,'20000000-0000-0000-0000-000000000001'::uuid,
       'Ativação Colonial — Shopping Catuaí','Colonial','Catuaí Shopping Londrina','Rod. Celso Garcia Cid, 5600 — Londrina/PR',
       -23.3448, -51.1956, 'confirmado'::status_evento, '{"abordagens": 1500, "degustacoes": 800}'::jsonb,
       '{"uniforme": "Camiseta Colonial + calça jeans", "treinamento": "Briefing 30 min antes", "alimentacao": "Lanche no intervalo"}'::jsonb
  FROM sab
UNION ALL
SELECT '60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002',
       'Festival de Inverno — Maringá','Colonial','Parque do Ingá','Av. São Paulo — Maringá/PR',
       -23.4253, -51.9310, 'confirmado', '{"leads": 600}', '{}'
  FROM sab;

WITH sab AS (SELECT (current_date + ((6 - extract(dow FROM current_date)::int + 7) % 7))::date AS d)
INSERT INTO turno (id, evento_id, nome, inicio, fim)
SELECT '70000000-0000-0000-0000-000000000001'::uuid,'60000000-0000-0000-0000-000000000001'::uuid,'Sábado — tarde',
       (d + time '14:00') AT TIME ZONE 'America/Sao_Paulo', (d + time '20:00') AT TIME ZONE 'America/Sao_Paulo' FROM sab
UNION ALL
SELECT '70000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','Sábado — noite',
       (d + time '18:00') AT TIME ZONE 'America/Sao_Paulo', (d + 1 + time '01:00') AT TIME ZONE 'America/Sao_Paulo' FROM sab;

INSERT INTO posto (id, turno_id, funcao_id, quantidade, diaria_custo, diaria_venda, uniforme, requisitos) VALUES
 ('80000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',
  4, 180.00, 320.00, 'Camiseta Colonial M/G', '{"idade_min": 18, "tamanhos_camiseta": ["M","G"]}'),
 ('80000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004',
  2, 160.00, 290.00, 'Avental + touca', '{"idade_min": 18}'),
 ('80000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',
  3, 220.00, 390.00, 'Camiseta festival', '{"idade_min": 18, "altura_min": 165}'),
 ('80000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000005',
  2, 200.00, 350.00, NULL, '{}');

INSERT INTO evento_supervisor VALUES ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003');

INSERT INTO checklist_item (evento_id, descricao, prazo) VALUES
 ('60000000-0000-0000-0000-000000000001','Retirar uniformes no fornecedor', current_date + 2),
 ('60000000-0000-0000-0000-000000000001','Confirmar ponto de energia no shopping', current_date + 3);

-- Escala já iniciada no evento de Londrina
INSERT INTO alocacao (posto_id, profissional_id, status, criado_por) VALUES
 ('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','confirmado','10000000-0000-0000-0000-000000000002'),
 ('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000004','confirmado','10000000-0000-0000-0000-000000000002'),
 ('80000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000010','convidado','10000000-0000-0000-0000-000000000002'),
 ('80000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000005','confirmado','10000000-0000-0000-0000-000000000002');

COMMIT;

-- Popular o BI com o estado inicial
SELECT analytics.atualizar(false);
