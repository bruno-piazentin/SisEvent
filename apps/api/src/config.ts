function obrigatorio(nome: string, padraoDev?: string): string {
  const valor = process.env[nome] ?? (process.env.NODE_ENV !== 'production' ? padraoDev : undefined);
  if (!valor) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  return valor;
}

// valores de exemplo publicados no repositório (.env.example, docker-compose): em produção não servem
const EXEMPLOS = ['dev-inseguro-troque-isto', 'troque-este-segredo-em-producao', 'troque-por-uma-sequencia-longa-e-aleatoria'];
function segredo(nome: string): string {
  const valor = obrigatorio(nome, 'dev-inseguro-troque-isto');
  if (process.env.NODE_ENV === 'production' && EXEMPLOS.includes(valor)) {
    throw new Error(`${nome} está com o valor de exemplo do repositório. Gere um valor próprio antes de publicar.`);
  }
  return valor;
}

/** trust proxy do Express: TRUST_PROXY (número de proxies ou 'loopback'); na Vercel e no Render, 1 */
function confiancaProxy(): boolean | number | string {
  const v = process.env.TRUST_PROXY;
  if (v !== undefined && v !== '') return /^\d+$/.test(v) ? Number(v) : v === 'false' ? false : v;
  return process.env.VERCEL || process.env.RENDER ? 1 : false;
}

export const config = {
  porta: Number(process.env.PORT ?? 3001),
  // Usuário membro do papel app_api (sem BYPASSRLS). Nunca use o superusuário aqui.
  databaseUrl: obrigatorio('DATABASE_URL', 'postgres://sisevent_api:sisevent_api@localhost:5432/sisevent'),
  // Banco gerenciado (Supabase, RDS...) exige SSL. DB_SSL=true liga a criptografia.
  // Com DB_SSL_CA (o certificado do Supabase, em Database > SSL Configuration) o servidor também
  // é conferido; sem ele a conexão é cifrada, mas não verifica com quem fala.
  // Não use ?sslmode= na DATABASE_URL junto com DB_SSL: o da URL prevalece.
  dbSsl: process.env.DB_SSL === 'true'
    ? (process.env.DB_SSL_CA
      ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n'), rejectUnauthorized: true }   // aceita o PEM em uma linha, com \n
      : { rejectUnauthorized: false })
    : undefined,
  jwtSegredo: segredo('JWT_SECRET'),
  // Chave da criptografia dos dados pessoais (comum/cripto.ts). Gere com `npm run gerar-chave`.
  // Sem ela, quem já foi gravado não pode mais ser lido: guarde com os outros segredos.
  dadosChave: segredo('DADOS_CHAVE'),
  trustProxy: confiancaProxy(),
  // Metabase: só os painéis listados aqui podem ser incorporados (vazio = nenhum)
  metabasePaineis: (process.env.METABASE_DASHBOARDS ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0),
  jwtValidade: process.env.JWT_EXPIRES_IN ?? '12h',
  // URL pública do app web — usada para montar o link mágico e a URL do QR
  appUrl: obrigatorio('APP_URL', 'http://localhost:3000'),
  corsOrigens: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(','),
  // Metabase (BI embutido). Opcional na Fase 1.
  metabaseUrl: process.env.METABASE_URL,
  metabaseEmbedSegredo: process.env.METABASE_EMBED_SECRET,
  // Atualização da camada analítica (minutos). 0 desliga.
  biIntervaloMin: Number(process.env.BI_REFRESH_MINUTES ?? 60),
  // Usuário master de manutenção: entra como admin em qualquer empresa.
  // Só o hash bcrypt da senha fica no ambiente (gere com `npm run hash-senha`). Sem os dois, fica desligado.
  master: process.env.MASTER_EMAIL && process.env.MASTER_SENHA_HASH
    ? { email: process.env.MASTER_EMAIL.toLowerCase(), nome: process.env.MASTER_NOME ?? 'Manutenção', senhaHash: process.env.MASTER_SENHA_HASH }
    : undefined,
};
