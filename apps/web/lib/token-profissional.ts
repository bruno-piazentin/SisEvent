'use client';
// O link mágico (/p/<token>) fica salvo no aparelho para o check-in por QR funcionar
// mesmo quando a pessoa abre a câmera direto, sem passar pela página dela.
const CHAVE = 'sisevent.token_profissional';

export function salvarToken(token: string) {
  try { localStorage.setItem(CHAVE, token); } catch { /* navegação privada */ }
}
export function lerToken(): string | null {
  try { return localStorage.getItem(CHAVE); } catch { return null; }
}
export function esquecerToken() {
  try { localStorage.removeItem(CHAVE); } catch { /* */ }
}
