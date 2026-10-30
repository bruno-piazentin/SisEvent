# Arquitetura e implantação

## Decisões

| Tema | Decisão | Por quê |
|---|---|---|
| Estrutura | Monólito modular (1 API + 1 web) | 5–10 usuários internos e centenas de profissionais não justificam microserviços; módulos ligam/desligam por configuração. |
| Banco | PostgreSQL 16 | Relacional e transacional (é dinheiro), exclusion constraint para conflito de escala, RLS para isolamento, JSONB para requisitos variáveis, `tsmultirange` para cruzar disponibilidade. |
| Regras críticas | No banco (constraints, triggers, funções) | Nenhuma tela, integração ou script consegue furar conflito de horário, lotação ou trava de fechamento. |
| Front | Next.js como PWA | Um código para painel e celular; o profissional abre por link, sem instalar. |
| Acesso do profissional | Link mágico (token de 256 bits, só o hash no banco, validade de 30 dias) | Premissa de adoção do escopo: sem senha, sem app. |
| Prova de presença | QR rotativo (HMAC do tempo, troca a cada 30 s) | Foto do QR enviada ao colega expira. Geolocalização e selfie ficam opcionais por evento. |
| Sem sinal no local | Fila offline no celular + validação do QR pela hora da leitura | Festival e shopping lotado derrubam a internet; o registro não se perde e não duplica. |
| BI | Schema `analytics` (estrela) + Metabase | Histórico e auditoria desde o dia 1; o modelo migra para warehouse colunar sem refazer painéis. |

## Hospedagem recomendada (dados no Brasil)

### Fase 1 — enxuta

| Peça | Serviço | Observação |
|---|---|---|
| Banco | **Supabase**, região São Paulo | Postgres gerenciado com backup e restauração a qualquer ponto. Use a *connection string* do pooler em modo transação para a API: o `SET LOCAL` do contexto é por transação, então funciona com pooling. |
| API | **Render** ou **Railway** (container do `apps/api/Dockerfile`) | Rodar o alvo `migracoes` como *job* a cada deploy, antes da API. |
| Web | **Vercel** | `NEXT_PUBLIC_API_URL` apontando para a API; domínio próprio com HTTPS (obrigatório para câmera e GPS no celular). |
| BI | Metabase em container (Render/Railway) ou Metabase Cloud | Conectar com o usuário `metabase` (somente leitura no schema `analytics`). |
| Arquivos (fotos, documentos) | Supabase Storage | Bucket privado; URLs assinadas. |

### Quando crescer — AWS São Paulo (sa-east-1)

RDS PostgreSQL Multi-AZ + réplica de leitura para o BI, ECS Fargate para API/web/Metabase, S3 + CloudFront. Como tudo é Postgres padrão e containers, a migração é troca de *connection string* e de destino do deploy.

Confirme preços e regiões atuais dos provedores antes de fechar o orçamento.

## Usuários do banco

| Usuário | Papel | Uso |
|---|---|---|
| dono (ex.: `postgres` no Supabase, `sisevent_owner` no Docker) | dono do schema | só migrações |
| `sisevent_api` | membro de `app_api` (sem BYPASSRLS) | conexão da API |
| `metabase` | membro de `bi_leitor` | BI, lê só `analytics` |

O script `scripts/migrate.ts` cria `sisevent_api` e `metabase` quando `API_DB_PASSWORD` e `METABASE_DB_PASSWORD` estão definidas.

## Liberação de módulos (operação)

1. A administradora abre **Módulos e acessos** e clica em **Liberar** no módulo contratado.
2. O módulo passa a aparecer no menu de quem tem permissão no perfil, no próximo carregamento.
3. Para dar algo a uma pessoa específica (ex.: um coordenador ver M7), use o ajuste individual.
4. `expira_em` permite liberação temporária (ex.: período de teste do M8).

Toda mudança de liberação e de permissão fica na tabela `auditoria`.

## Configurar o BI (Metabase)

1. Acesse o Metabase, crie o admin e adicione o banco Postgres com o usuário `metabase`.
2. Os painéis usam as views `analytics.kpi_mensal`, `kpi_cliente`, `kpi_profissional`, `kpi_ocupacao_base` e os fatos `fato_evento`, `fato_alocacao`, `fato_posto`.
3. Em *Admin → Embedding*, ative o embedding estático e copie a chave para `METABASE_EMBED_SECRET`.
4. Em cada painel, crie o filtro `tenant_id` e marque como **Locked** no embedding. A API (`GET /api/bi/embed/:id`) gera a URL com a empresa do usuário travada.
5. A camada analítica atualiza a cada `BI_REFRESH_MINUTES` (padrão 60). A administradora pode forçar pelo endpoint `POST /api/bi/atualizar`.

## Segurança — checklist de produção

- [ ] Trocar `JWT_SECRET`, senhas de banco e `CARREGAR_SEED=0`.
- [ ] Domínio com HTTPS para web e API; `CORS_ORIGINS` só com o domínio do app.
- [ ] Ativar 2FA para quem vê valores (campo `totp_segredo` já existe; fluxo entra na próxima entrega).
- [ ] Rate limit da área pública no proxy/CDN (o limite em memória da API vale para uma instância).
- [ ] Prazo de retenção de leads (M8) definido com a cliente antes de ativar o módulo.

## Validação feita nesta entrega

- Migrações aplicadas do zero em PostgreSQL 16 e suíte `db/tests/regras_negocio.sql` passando (permissões, conflito, lotação, cruzamento, QR, offline, idempotência, fechamento, trava, noturno, auditoria, RLS, BI).
- Todas as 97 consultas SQL estáticas da API preparadas contra o schema real como o papel `app_api`.
- Cenário ponta a ponta executando o código real dos controllers e do `DbService` contra o banco, com RLS ativo (login, menu por módulo, guard, busca, ficha, evento, sugestões, conflito, link mágico, aceite, QR, check-in, presença, ponto manual, fechamento, lote PIX, margem, BI, liberação de módulo e auditoria).
- **Não validado aqui:** `npm install` e o build do Next.js/NestJS, porque o ambiente de desenvolvimento usado bloqueava o registro do npm. Rode `docker compose up --build` na primeira subida e ajuste o que o compilador apontar.

## Próximos passos sugeridos

1. Primeira subida em homologação (Supabase + Render + Vercel) e teste de campo real com 2 ou 3 promotores.
2. Envio do link e das convocações por WhatsApp (depende da decisão sobre API oficial — premissa em aberto).
3. Upload de documentos e fotos (Storage) e alerta de vencimento por e-mail/WhatsApp.
4. Fase 2: M8 (leads com LGPD e relatório PDF) e M2 (formulário público e triagem).
5. Importador da base atual (planilhas) com fila de triagem — maior risco de cronograma apontado no escopo.
