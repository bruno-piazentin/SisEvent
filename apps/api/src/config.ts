function obrigatorio(nome: string, padraoDev?: string): string {
  const valor = process.env[nome] ?? (process.env.NODE_ENV !== 'production' ? padraoDev : undefined);
  if (!valor) throw new Error(`Variável de ambiente obrigatória ausente: ${nome}`);
  return valor;
}

export const config = {
  porta: Number(process.env.PORT ?? 3001),
  // Usuário membro do papel app_api (sem BYPASSRLS). Nunca use o superusuário aqui.
  databaseUrl: obrigatorio('DATABASE_URL', 'postgres://sisevent_api:sisevent_api@localhost:5432/sisevent'),
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
};
