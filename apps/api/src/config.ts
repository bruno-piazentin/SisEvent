function obrigatorio(nome: string, padraoDev?: string): string {
  const valor = process.env[nome] ?? (process.env.NODE_ENV !== 'production' ? padraoDev : undefined);
  if (!valor) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  return valor;
}

export const config = {
  porta: Number(process.env.PORT ?? 3001),
  // Usuário membro do papel app_api (sem BYPASSRLS). Nunca use o superusuário aqui.
  databaseUrl: obrigatorio('DATABASE_URL', 'postgres://sisevent_api:sisevent_api@localhost:5432/sisevent'),
  // Banco gerenciado (Supabase, RDS...) exige SSL. DB_SSL=true liga a criptografia;
  // o certificado do pooler não é de uma CA pública, por isso não é verificado.
  // Não use ?sslmode= na DATABASE_URL junto com DB_SSL: o da URL prevalece.
  dbSsl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  jwtSegredo: obrigatorio('JWT_SECRET', 'dev-inseguro-troque-isto'),
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
