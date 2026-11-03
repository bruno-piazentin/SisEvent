/**
 * Criptografa os dados pessoais que já estavam gravados em texto (migração 023):
 * CPF, RG e dados bancários do profissional e a chave PIX dos pagamentos.
 * Pode rodar mais de uma vez: o que já está criptografado fica como está.
 *   DADOS_CHAVE=<a mesma da API> DATABASE_URL_OWNER=postgres://dono@host/sisevent npm run cifrar-dados
 * Use EXATAMENTE a DADOS_CHAVE configurada na API: com outra chave a API não consegue ler.
 */
import { Client } from 'pg';

async function main() {
  const url = process.env.DATABASE_URL_OWNER ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL_OWNER');
  // fora do banco local, nunca cair na chave de desenvolvimento
  if (!process.env.DADOS_CHAVE && !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    throw new Error('Defina DADOS_CHAVE com a mesma chave configurada na API.');
  }
  const { CIFRADOS_PROFISSIONAL, cifrar, decifrar, indice } = await import('../src/comum/cripto');
  const db = new Client({ connectionString: url, ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined });
  await db.connect();
  await db.query('BEGIN');
  try {
    await db.query(`SELECT set_config('app.motivo', 'Criptografia dos dados pessoais (migração 023)', true)`);
    const texto = (v: string | null) => !!v && !v.startsWith('v1:');

    let profissionais = 0;
    const { rows } = await db.query(`SELECT id, cpf_hash, ${CIFRADOS_PROFISSIONAL.join(', ')} FROM profissional`);
    for (const r of rows) {
      const novos: Record<string, string | null> = {};
      for (const k of CIFRADOS_PROFISSIONAL) if (texto(r[k])) novos[k] = cifrar(r[k]) as string;
      const cpf = decifrar(r.cpf);
      if (cpf && !r.cpf_hash) novos.cpf_hash = indice(cpf);
      const campos = Object.keys(novos);
      if (!campos.length) continue;
      await db.query(`UPDATE profissional SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [r.id, ...campos.map((k) => novos[k])]);
      profissionais++;
    }

    let pagamentos = 0;
    const pg = await db.query(`SELECT id, chave_pix FROM pagamento_profissional WHERE chave_pix IS NOT NULL AND chave_pix NOT LIKE 'v1:%'`);
    for (const r of pg.rows) {
      await db.query('UPDATE pagamento_profissional SET chave_pix = $2 WHERE id = $1', [r.id, cifrar(r.chave_pix)]);
      pagamentos++;
    }
    await db.query('COMMIT');
    console.log(`ok: ${profissionais} profissionais e ${pagamentos} pagamentos criptografados.`);
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
