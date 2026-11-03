import { HttpException } from '@nestjs/common';

// Limite simples por chave (IP, IP + e-mail...) contra tentativa e erro de senhas e tokens.
// Em produção com várias instâncias cada uma conta separado; o bloqueio por usuário
// (registrar_tentativa_login, no banco) vale para todas.
const tentativas = new Map<string, { n: number; ate: number }>();

export function limitar(chave: string, max = 60, janelaMs = 60_000, mensagem = 'Aguarde um minuto e tente de novo.') {
  const agora = Date.now();
  const t = tentativas.get(chave);
  if (!t || t.ate < agora) { tentativas.set(chave, { n: 1, ate: agora + janelaMs }); return; }
  if (++t.n > max) throw new HttpException({ codigo: 'muitas_tentativas', mensagem }, 429);
}

setInterval(() => { const a = Date.now(); for (const [k, v] of tentativas) if (v.ate < a) tentativas.delete(k); }, 60_000).unref();
