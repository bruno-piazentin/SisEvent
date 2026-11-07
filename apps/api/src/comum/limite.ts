import { HttpException } from '@nestjs/common';
import { createHash } from 'node:crypto';

// Limite simples por chave (IP, IP + e-mail...) contra tentativa e erro de senhas e tokens.
// Em produção com várias instâncias cada uma conta separado; o bloqueio por usuário
// (reservar_tentativa_login, no banco) vale para todas.
// A chave é guardada como hash (tamanho fixo) e o mapa tem teto: requisições sem login
// não conseguem prender memória com chaves enormes ou em quantidade ilimitada.
const tentativas = new Map<string, { n: number; ate: number }>();
const MAX_CHAVES = 50_000;

export function limitar(chaveBruta: string, max = 60, janelaMs = 60_000, mensagem = 'Aguarde um minuto e tente de novo.') {
  const chave = createHash('sha256').update(chaveBruta).digest('base64url');
  const agora = Date.now();
  const t = tentativas.get(chave);
  if (!t || t.ate < agora) {
    if (!t && tentativas.size >= MAX_CHAVES) tentativas.delete(tentativas.keys().next().value!);   // sai a mais antiga
    tentativas.set(chave, { n: 1, ate: agora + janelaMs });
    return;
  }
  if (++t.n > max) throw new HttpException({ codigo: 'muitas_tentativas', mensagem }, 429);
}

setInterval(() => { const a = Date.now(); for (const [k, v] of tentativas) if (v.ate < a) tentativas.delete(k); }, 60_000).unref();
