/**
 * Gera docs/manual/Manual-Cachet.pdf a partir de docs/manual/manual.html.
 *   npm run manual
 * Usa o Chrome ou o Edge já instalados (modo headless): nenhuma dependência nova.
 * Outro navegador: defina CHROME_PATH com o caminho do executável.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = join(raiz, 'docs', 'manual', 'manual.html');
const destino = join(raiz, 'docs', 'manual', 'Manual-Cachet.pdf');

// Chrome primeiro: em alguns Windows o Edge headless sai sem gerar nada (política da empresa, Edge já aberto)
const navegadores = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
].filter((c) => c && existsSync(c));
if (!navegadores.length) {
  console.error('Chrome ou Edge não encontrado. Defina CHROME_PATH com o caminho do navegador.');
  process.exit(1);
}

// versão = commit atual (com * se houver alterações ainda não commitadas)
let versao = 'local';
try {
  versao = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: raiz }).toString().trim();
  if (execFileSync('git', ['status', '--porcelain', '--', '.', ':!docs/manual/Manual-Cachet.pdf'], { cwd: raiz }).toString().trim()) versao += '*';
} catch { /* fora de um repositório git */ }
const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

const pasta = mkdtempSync(join(tmpdir(), 'manual-'));
const temporario = join(pasta, 'manual.pdf');
let usado;
try {
  const html = join(pasta, 'manual.html');
  writeFileSync(html, readFileSync(fonte, 'utf8').replaceAll('{{ATUALIZADO_EM}}', hoje).replaceAll('{{VERSAO}}', versao));
  for (const navegador of navegadores) {
    try {
      execFileSync(navegador, [
        '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run',
        `--user-data-dir=${join(pasta, 'perfil')}`, `--print-to-pdf=${temporario}`, pathToFileURL(html).href,
      ], { stdio: 'ignore', timeout: 120_000 });
    } catch { /* tenta o próximo navegador */ }
    if (existsSync(temporario) && statSync(temporario).size > 0) { usado = navegador; break; }
  }
  // só substitui o PDF anterior quando o novo saiu inteiro
  if (usado) copyFileSync(temporario, destino);
} finally {
  // o navegador pode demorar a soltar os arquivos do perfil temporário; a limpeza não pode derrubar a geração
  try { rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* fica na pasta temporária do sistema */ }
}

if (!usado) { console.error(`Nenhum navegador gerou o PDF (tentados: ${navegadores.join(', ')}).`); process.exit(1); }
console.log(`Manual gerado: ${destino} (${Math.round(statSync(destino).size / 1024)} KB, versão ${versao}, ${hoje})`);
