# Cachet — Rafa Dutra Eventos

Sistema web de gestão de casting e execução de eventos: do cadastro do promotor ao check-in pelo celular, fechamento do evento, pagamento e margem por job. Liberado por módulos e com camada de BI desde o início.

```
Evento → Turno → Posto → Alocação → Apontamento → Custo → Pagamento / Faturamento
```

## O que já está pronto (Fase 1 + check-in)

| Módulo | O que faz |
|---|---|
| **Liberação por módulos** | 3 camadas: módulos da empresa → perfil × módulo × ação → ajuste por usuário. Regra única no banco (`tem_permissao`), usada pela API, pelo menu e pelo BI. |
| **M1 Banco de talentos** | Ficha detalhada (medidas, disponibilidade por dia/horário, meios de locomoção, praças, documentos com validade, avaliações), busca com filtros combinados e "quem está livre neste horário". |
| **M3 Clientes** | Marcas e agências, contatos, pipeline e propostas (tabelas prontas). |
| **M4 Eventos e postos** | Evento com vários turnos e postos, requisitos de casting por posto, checklist, clonagem de evento como template. |
| **M5 Escala** | **Cruzamento profissional × posto** com pontuação, motivos e alertas; convite, aceite, suplentes; **trava de conflito de horário no banco**; lotação do posto; histórico completo. |
| **M6 Campo** | **Link mágico** para o profissional (sem senha, sem app); **QR rotativo de 30 s** na tela do supervisor; check-in/out com **fila offline**; atraso e saída antecipada automáticos; ponto manual com justificativa; substituição em campo; ocorrências. |
| **M7 Financeiro** | Cálculo com hora extra, adicional noturno, descontos e lançamentos; fechamento com pendências (critério de aceite 1); pagamentos, lote PIX em CSV, fatura ao cliente, margem por evento e por cliente. |
| **BI** | Schema `analytics` em modelo estrela (dimensões e fatos), indicadores prontos, atualização automática, papel somente leitura e Metabase embutido com a empresa travada no token. |
| **M2, M8, M9** | Rotas e liberação prontas; telas entram nas fases 2 e 3. |

## Rodar localmente (Docker)

```bash
cp .env.example .env
docker compose up --build
```

- Web: http://localhost:3000 — empresa `rafadutra`, senha `sisevent123`
  - `rafa@rafadutra.com.br` (administradora) · `central@…` · `supervisor@…` · `financeiro@…`
- API: http://localhost:3001/api
- Metabase (BI): http://localhost:3002

Para testar o check-in **no celular** na mesma rede Wi-Fi, troque `APP_URL` e `PUBLIC_API_URL` no `.env` pelo IP do computador (ex.: `http://192.168.0.10:3000`). Câmera e geolocalização exigem HTTPS fora de `localhost`, então o teste completo de campo deve ser feito no ambiente publicado.

## Manual do usuário

Manual em PDF para a equipe: [docs/manual/Manual-Cachet.pdf](docs/manual/Manual-Cachet.pdf).
O texto fica em [docs/manual/manual.html](docs/manual/manual.html): ao mudar uma tela ou regra, atualize a seção dela
e o "Histórico de atualizações", e gere o PDF de novo com `npm run manual` (usa o Chrome ou o Edge instalados).

## Publicar (Supabase + Render + Vercel)

Passo a passo, variáveis de ambiente e checklist em [docs/publicacao.md](docs/publicacao.md).
A Vercel hospeda só o site (`apps/web`); a API (`apps/api`) e o banco ficam no Render e no Supabase.

## Rodar sem Docker

```bash
# Postgres 16 local, com um banco "sisevent"
cd apps/api && npm install
DATABASE_URL_OWNER=postgres://postgres@localhost/sisevent API_DB_PASSWORD=api_dev npm run seed
DATABASE_URL=postgres://sisevent_api:api_dev@localhost/sisevent npm run dev

cd ../web && npm install && npm run dev
```

## Testes

```bash
# Regras de negócio no banco (conflito, lotação, cruzamento, QR, offline, fechamento, RLS, BI)
psql "$DATABASE_URL_OWNER" -f apps/api/db/tests/regras_negocio.sql
```

O script roda tudo numa transação desfeita no final: não altera os dados.

## Estrutura

```
apps/
  api/                    NestJS (monólito modular, um controller por módulo)
    db/migrations/        001..009 — schema, regras, BI e segurança (SQL puro)
    db/seed.sql           dados de demonstração
    db/tests/             testes das regras de negócio
    src/auth              login, JWT, guard de módulo (@Requer('M5','editar'))
    src/profissionais     M1   src/cadastros  praças, funções, clientes (M3)
    src/eventos           M4   src/escala     M5   src/campo  M6
    src/financeiro        M7   src/bi         BI   src/publico área do profissional (link)
  web/                    Next.js (PWA)
    app/(painel)/…        painel interno
    app/p/[token]         área do profissional (celular)
    app/c/[evento]/[cod]  destino do QR escaneado pela câmera
    app/qr/[id]           QR rotativo do supervisor
docs/arquitetura-e-implantacao.md
```

## Onde estão as regras importantes

As regras que não podem ser furadas ficam **no banco**, não só na tela:

- `alocacao.sem_conflito_horario` — exclusion constraint: mesma pessoa em dois lugares ao mesmo tempo é recusada.
- `trg_alocacao_preparar` — impede exceder a quantidade do posto.
- `trg_bloquear_evento_fechado` — nada muda depois do fechamento (reabertura só com justificativa).
- `registrar_ponto()` — valida link, QR rotativo, janela de horário, geolocalização opcional e sincronização offline.
- `fechar_evento()` — pendências, faltas, custo por pessoa, pagamentos, fatura e margem.
- `sugerir_profissionais()` — o cruzamento promotor × posto.
- Políticas RLS — uma empresa nunca lê dados de outra, mesmo com bug na API.
