/**
 * Gera o hash bcrypt de uma senha para MASTER_SENHA_HASH.
 *   npm run hash-senha -- "minha senha"
 * A senha em si nunca vai para o código nem para o .env: só o hash.
 */
import bcrypt from 'bcryptjs';

const senha = process.argv[2];
if (!senha || senha.length < 8) {
  console.error('Uso: npm run hash-senha -- "senha com pelo menos 8 caracteres"');
  process.exit(1);
}

const hash = bcrypt.hashSync(senha, 10);
console.log(`\nVercel / Render (valor da variável):\n${hash}\n`);
// aspas simples: o Docker Compose não tenta interpretar os "$" do hash
console.log(`Arquivo .env (Docker):\nMASTER_SENHA_HASH='${hash}'\n`);
