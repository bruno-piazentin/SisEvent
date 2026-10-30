/**
 * Aplica as migrações SQL em ordem, uma única vez cada (tabela schema_migracoes).
 *   DATABASE_URL_OWNER=postgres://dono@host/sisevent npm run migrate
 *   npm run seed   → migra e carrega os dados de demonstração
 * Rode com o usuário DONO do schema (não com o usuário da API).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL_OWNER');
  const db = new Client({ connectionString: url });
  await db.connect();
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migracoes (arquivo text PRIMARY KEY, aplicado_em timestamptz NOT NULL DEFAULT now())`);
  const feitas = new Set((await db.query('SELECT arquivo FROM schema_migracoes')).rows.map((r) => r.arquivo));

  const pasta = join(__dirname, '..', 'db', 'migrations');
  for (const arquivo of readdirSync(pasta).filter((f) => f.endsWith('.sql')).sort()) {
    if (feitas.has(arquivo)) continue;
    process.stdout.write(`→ ${arquivo} ... `);
    await db.query('BEGIN');
    try {
      await db.query(readFileSync(join(pasta, arquivo), 'utf8'));
      await db.query('INSERT INTO schema_migracoes (arquivo) VALUES ($1)', [arquivo]);
      await db.query('COMMIT');
      console.log('ok');
    } catch (e) {
      await db.query('ROLLBACK');
      console.log('ERRO');
      throw e;
    }
  }

  // usuário de login da API (membro de app_api, sujeito ao RLS)
  const apiUser = process.env.API_DB_USER ?? 'sisevent_api';
  const apiPass = process.env.API_DB_PASSWORD;
  if (apiPass) {
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${apiUser}') THEN
        CREATE ROLE ${apiUser} LOGIN PASSWORD '${apiPass.replace(/'/g, "''")}' IN ROLE app_api;
      END IF; END $$`);
  }

  // usuário somente leitura do Metabase (enxerga só o schema analytics)
  const mbPass = process.env.METABASE_DB_PASSWORD;
  if (mbPass) {
    await db.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'metabase') THEN
        CREATE ROLE metabase LOGIN PASSWORD '${mbPass.replace(/'/g, "''")}' IN ROLE bi_leitor;
      END IF; END $$`);
  }

  if (process.argv.includes('--seed')) {
    const temDados = (await db.query('SELECT count(*)::int AS n FROM tenant')).rows[0].n > 0;
    if (temDados) console.log('Seed ignorado: banco já tem empresas.');
    else {
      await db.query(readFileSync(join(__dirname, '..', 'db', 'seed.sql'), 'utf8'));
      console.log('Seed de demonstração carregado.');
    }
  }
  await db.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
