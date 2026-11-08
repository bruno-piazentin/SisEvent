# Publicação (Supabase + Render + Vercel)

O Cachet tem três partes, e cada uma vai para um serviço:

| Parte | Pasta | Onde | Por quê |
|---|---|---|---|
| Banco de dados | `apps/api/db` | **Supabase** (região São Paulo) | Postgres gerenciado, com backup |
| API | `apps/api` | **Render** (Web Service) | Processo contínuo: conexão com o banco, atualização do BI a cada hora, envio de fotos |
| Site (telas) | `apps/web` | **Vercel** | Next.js |

A Vercel publica **só o site**. Sem a API no ar, o site abre mas o login não funciona.
Faça na ordem: banco → API → site.

> **Alternativa: site e API juntos na Vercel (serviços).** O `vercel.json` da raiz declara dois serviços
> no mesmo projeto: `web` (`apps/web`, público em `/`) e `api` (`apps/api`, público em `/api/*`).
> Nesse modo, pule o passo 2 (Render). Na Vercel, importe o repositório **sem** mudar o Root Directory e
> cadastre no projeto as variáveis da API do passo 2.3 (`DATABASE_URL`, `DB_SSL`, `JWT_SECRET`, `APP_URL`...).
> `NEXT_PUBLIC_API_URL` não é necessária: o site usa `/api` no mesmo domínio, então também não há CORS.
> Diferenças em relação ao Render: a API roda como função (sem processo contínuo), então a atualização
> automática do BI a cada hora fica desligada (use o botão do BI ou um agendamento); o corpo de cada
> requisição é limitado a 4,5 MB (as fotos já chegam reduzidas pelo navegador, em geral abaixo de 1 MB);
> o pool usa 2 conexões por instância (`DB_POOL_MAX`).

---

## 1. Banco (Supabase)

1. Crie o projeto em https://supabase.com, região **South America (São Paulo)**. Guarde a senha do banco.
2. **Desligue a Data API** (Project Settings → Data API → desativar). O Cachet não usa a API automática do
   Supabase e ela exporia tabelas do schema `public` a quem tivesse a chave `anon`.
3. Em **Connect**, copie duas *connection strings*:
   - **Session pooler** (porta 5432) → para as migrações.
   - **Transaction pooler** (porta 6543) → para a API. O contexto de cada requisição é `SET LOCAL`
     dentro da transação, então funciona com o pooler em modo transação.
4. Rode as migrações **do seu computador**, apontando para o Supabase (PowerShell, na pasta `apps/api`):

   ```powershell
   $env:DATABASE_URL_OWNER = 'postgresql://postgres.<ref>:<SENHA>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres'
   $env:DB_SSL = 'true'
   $env:API_DB_PASSWORD = '<senha forte para o usuário da API>'
   $env:METABASE_DB_PASSWORD = '<senha forte para o BI>'   # opcional
   npm run migrate          # produção: sem dados de demonstração
   # npm run seed           # só em homologação: migra e carrega a empresa de demonstração
   ```

   Isso cria as tabelas, as regras e o usuário `sisevent_api` (sem acesso fora da própria empresa).
   Não coloque `?sslmode=` na URL: o `DB_SSL=true` já cuida da criptografia.

5. As empresas: em produção não há seed. Com o usuário master configurado (veja o passo 2.3), o
   **primeiro login** dele cria a empresa digitada no campo Empresa (ex.: `rafadutra`), com todos os
   módulos, só enquanto o banco não tiver nenhuma empresa. As demais empresas e os usuários de cada uma
   são cadastrados na tela **Empresas** (menu, só para o master). Cada empresa é isolada pelo RLS:
   mesmo banco, mas nenhuma enxerga os dados de outra.

## 2. API (Render)

1. https://render.com → **New → Web Service** → conecte o repositório `bruno-piazentin/SisEvent`.
2. Configuração:

   | Campo | Valor |
   |---|---|
   | Root Directory | `apps/api` |
   | Runtime | Node |
   | Build Command | `npm install --include=dev && npm run build` |
   | Start Command | `npm start` |
   | Health Check Path | `/api/publico/saude` |
   | Região | a mais próxima disponível do Brasil |

   O `--include=dev` é necessário: o TypeScript é dependência de desenvolvimento e o `NODE_ENV=production`
   faria o npm pulá-lo.

3. Variáveis de ambiente:

   | Variável | Valor |
   |---|---|
   | `NODE_ENV` | `production` |
   | `DATABASE_URL` | Transaction pooler, **com o usuário da API**: `postgresql://sisevent_api.<ref>:<API_DB_PASSWORD>@aws-0-sa-east-1.pooler.supabase.com:6543/postgres` |
   | `DB_SSL` | `true` |
   | `DB_POOL_MAX` | `5` |
   | `JWT_SECRET` | sequência longa e aleatória (ex.: gerada por um gerenciador de senhas, 64+ caracteres) |
   | `APP_URL` | endereço do site na Vercel, ex.: `https://sisevent.vercel.app` (vai no link do profissional e no QR) |
   | `CORS_ORIGINS` | o mesmo endereço do site; vários separados por vírgula (ex.: domínio próprio + vercel.app) |
   | `BI_REFRESH_MINUTES` | `60` |
   | `METABASE_URL` / `METABASE_EMBED_SECRET` | só se for usar o BI |
   | `MASTER_EMAIL` / `MASTER_NOME` / `MASTER_SENHA_HASH` | usuário master de manutenção (veja abaixo) |

   **Usuário master.** Entra como admin em qualquer empresa: na tela de login, o código da empresa,
   o `MASTER_EMAIL` e a senha. No primeiro acesso a uma empresa ele é criado lá como usuário admin
   (aparece na lista de usuários e fica na auditoria). A senha não fica no código nem no ambiente, só o hash:
   gere com `npm run hash-senha -- "SENHA"` em `apps/api` e cole o resultado em `MASTER_SENHA_HASH`.
   Para trocar a senha, gere outro hash e troque a variável; vale para todas as empresas.
   Só o master vê o menu **Empresas**: cadastrar empresas, liberar módulos, criar e inativar usuários,
   redefinir senhas e inativar uma empresa inteira (ninguém dela entra até reativar; os dados ficam).
   Sem essas variáveis, o master fica desligado.

   No Supabase, o usuário do pooler leva o *ref* do projeto: `sisevent_api.<ref>`, não só `sisevent_api`.

4. Depois do deploy, teste: `https://<sua-api>.onrender.com/api/publico/saude` deve responder.

> O plano gratuito do Render "dorme" após inatividade (o primeiro acesso demora ~1 min) e encerra
> processos em segundo plano. Para uso real, use um plano pago.

## 3. Site (Vercel)

1. https://vercel.com → **Add New → Project** → importe `bruno-piazentin/SisEvent`.
2. **Root Directory: `apps/web`** (botão *Edit* ao lado do nome do repositório). O resto é detectado
   pelo `apps/web/vercel.json` (instala as dependências a partir da raiz do monorepo).
3. Variável de ambiente (Production e Preview):

   | Variável | Valor |
   |---|---|
   | `NEXT_PUBLIC_API_URL` | `https://<sua-api>.onrender.com/api` |

   Sem ela o build **para de propósito**, com a mensagem explicando o que falta.
   Por ser `NEXT_PUBLIC_`, ela entra no código do site no momento do build: se mudar, faça **Redeploy**.

4. Deploy. Depois, volte ao Render e confira se `APP_URL` e `CORS_ORIGINS` têm exatamente o endereço
   final do site (com `https://`, sem barra no fim).

### Domínio próprio
Vercel → Settings → Domains. Ao trocar de domínio, atualize `APP_URL` e `CORS_ORIGINS` na API.
Câmera (QR) e localização no celular exigem HTTPS, que a Vercel e o Render já fornecem.

### Links de prévia (Preview)
Cada push em outra branch gera um endereço de prévia na Vercel. Ele só consegue logar se estiver em
`CORS_ORIGINS`. Para homologação, prefira um projeto/ambiente separado com seu próprio banco.

---

## Checklist antes de liberar para a equipe

- [ ] Data API do Supabase desligada.
- [ ] Senhas novas (banco, `sisevent_api`, `JWT_SECRET`); nenhuma senha de demonstração em produção.
- [ ] Migrações sem seed (`npm run migrate`), empresa e usuários reais criados.
- [ ] `APP_URL` e `CORS_ORIGINS` com o endereço final do site.
- [ ] Login, cadastro de cliente, evento, convite e check-in pelo celular testados no endereço publicado.
- [ ] Backup do Supabase conferido (plano com *Point in Time Recovery* para produção).

## Atualizações

Cada `git push` na branch `main` publica de novo o site (Vercel) e a API (Render) automaticamente.
Se a atualização trouxer uma migração nova (`apps/api/db/migrations/0NN_*.sql`), rode o passo 1.4
**antes** do push, para o banco já estar pronto quando a nova API subir.
