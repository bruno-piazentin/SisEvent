import { NextResponse, type NextRequest } from 'next/server';

// Política de segurança de conteúdo (CSP) com nonce: a cada página o servidor sorteia um código e o
// navegador só roda scripts do próprio Cachet que trazem esse código. Se um dia um texto malicioso
// conseguir entrar na página (XSS), o script dele não roda e não alcança a sessão guardada no aparelho.
// O Next coloca o nonce nos scripts dele sozinho (lê do cabeçalho da requisição); o do tema, no layout.
const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const ORIGEM_API = /^https?:\/\//.test(API) ? new URL(API).origin : '';   // '/api' (Vercel) já é o próprio site

export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    // strict-dynamic: os scripts que o Next carrega a partir dos dele herdam a permissão. Em dev o recarregamento usa eval
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",   // estilos inline do React (style={...}): não executam código
    "img-src 'self' data: blob:",         // fotos baixadas viram blob:, QR e logo são data:
    "font-src 'self' data:",
    `connect-src 'self'${ORIGEM_API ? ` ${ORIGEM_API}` : ''}${dev ? ' ws:' : ''}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const cabecalhos = new Headers(req.headers);
  cabecalhos.set('x-nonce', nonce);
  cabecalhos.set('Content-Security-Policy', csp);
  const res = NextResponse.next({ request: { headers: cabecalhos } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  // páginas apenas: arquivos estáticos, service worker e API ficam de fora; pré-carregamentos também
  matcher: [{
    source: '/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|icone.svg).*)',
    missing: [{ type: 'header', key: 'next-router-prefetch' }, { type: 'header', key: 'purpose', value: 'prefetch' }],
  }],
};
