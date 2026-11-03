import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from 'node:crypto';
import { config } from '../config';

/**
 * Criptografia dos dados pessoais gravados no banco (CPF, RG, dados bancários).
 * AES-256-GCM com a chave de DADOS_CHAVE: quem tiver só o banco (backup, credencial vazada) não lê.
 * Formato gravado: "v1:" + base64url(iv | tag | texto cifrado).
 * PERDER A CHAVE = PERDER ESSES DADOS. Guarde-a junto dos outros segredos de produção.
 */
const PREFIXO = 'v1:';
const chaveCifra = Buffer.from(hkdfSync('sha256', config.dadosChave, 'sisevent', 'cifra-dados', 32));
const chaveIndice = Buffer.from(hkdfSync('sha256', config.dadosChave, 'sisevent', 'indice-dados', 32));

/** Profissional: colunas gravadas criptografadas */
export const CIFRADOS_PROFISSIONAL = ['cpf', 'rg', 'chave_pix', 'banco', 'agencia', 'conta', 'cnpj_mei'] as const;

export function cifrar(valor: string | null | undefined): string | null | undefined {
  if (valor === null || valor === undefined || valor === '' || valor.startsWith(PREFIXO)) return valor;
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chaveCifra, iv);
  const corpo = Buffer.concat([c.update(valor, 'utf8'), c.final()]);
  return PREFIXO + Buffer.concat([iv, c.getAuthTag(), corpo]).toString('base64url');
}

/** Valores ainda não migrados (texto puro) passam direto */
export function decifrar(valor: string | null | undefined): string | null | undefined {
  if (!valor || !valor.startsWith(PREFIXO)) return valor;
  const b = Buffer.from(valor.slice(PREFIXO.length), 'base64url');
  const d = createDecipheriv('aes-256-gcm', chaveCifra, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}

/** Impressão digital para unicidade e busca exata (o mesmo CPF sempre gera o mesmo valor) */
export function indice(valor: string | null | undefined): string | null {
  if (!valor) return null;
  return createHmac('sha256', chaveIndice).update(valor.replace(/\D/g, '')).digest('hex');
}

/** Aplica cifrar() nas colunas indicadas de um objeto */
export function cifrarCampos<T extends Record<string, any>>(obj: T, campos: readonly string[]): T {
  for (const k of campos) if (k in obj) (obj as any)[k] = cifrar(obj[k]);
  return obj;
}

export function decifrarCampos<T extends Record<string, any>>(obj: T, campos: readonly string[]): T {
  for (const k of campos) if (obj[k] !== undefined) (obj as any)[k] = decifrar(obj[k]);
  return obj;
}
