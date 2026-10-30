# ---------- dependências ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ---------- build ----------
FROM deps AS build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------- migrações (job de uma execução) ----------
FROM deps AS migracoes
RUN apk add --no-cache postgresql16-client
COPY db ./db
COPY scripts ./scripts
COPY tsconfig.json ./
CMD ["sh", "-c", "if [ \"$CARREGAR_SEED\" = \"1\" ]; then npx tsx scripts/migrate.ts --seed; else npx tsx scripts/migrate.ts; fi"]

# ---------- produção ----------
FROM node:22-alpine AS producao
ENV NODE_ENV=production TZ=America/Sao_Paulo
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
