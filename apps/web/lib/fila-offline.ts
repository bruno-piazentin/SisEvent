'use client';

/**
 * Fila de check-in/out offline.
 * Em evento lotado ou festival o sinal some. O celular guarda o código do QR e a HORA DA LEITURA;
 * quando a internet volta, reenvia. O servidor valida o QR contra a hora do aparelho
 * e o registro é idempotente (reenvio não duplica).
 */
import { apiPublica, ErroApi } from './api';

export interface PontoPendente {
  id: string;
  token: string;
  evento_id: string;
  tipo: 'checkin' | 'checkout';
  codigo_qr?: string | null;
  dispositivo_em: string;
  lat?: number | null;
  lng?: number | null;
}

const CHAVE = 'sisevent.fila_ponto';

function ler(): PontoPendente[] {
  try { return JSON.parse(localStorage.getItem(CHAVE) ?? '[]'); } catch { return []; }
}
function gravar(fila: PontoPendente[]) {
  try { localStorage.setItem(CHAVE, JSON.stringify(fila)); } catch { /* sem armazenamento */ }
}

export function pendentes(): PontoPendente[] {
  return ler();
}

export function enfileirar(p: Omit<PontoPendente, 'id'>) {
  const fila = ler();
  // um pendente por evento+tipo é suficiente
  if (!fila.some((f) => f.evento_id === p.evento_id && f.tipo === p.tipo && f.token === p.token)) {
    fila.push({ ...p, id: crypto.randomUUID() });
    gravar(fila);
  }
}

/** Tenta enviar tudo que está na fila. Retorna as respostas do servidor. */
export async function sincronizar(): Promise<{ enviados: number; respostas: any[] }> {
  const fila = ler();
  if (!fila.length || !navigator.onLine) return { enviados: 0, respostas: [] };
  const restantes: PontoPendente[] = [];
  const respostas: any[] = [];
  for (const p of fila) {
    try {
      const r = await apiPublica(`/p/${p.token}/ponto`, {
        evento_id: p.evento_id, tipo: p.tipo, codigo_qr: p.codigo_qr,
        dispositivo_em: p.dispositivo_em, lat: p.lat, lng: p.lng,
      });
      respostas.push(r);
      // erro de regra (ex.: sem escala) não adianta reenviar; só mantém se for falha de rede
    } catch (e) {
      if (!(e instanceof ErroApi) || e.status >= 500 || e.status === 429) restantes.push(p);
      else respostas.push({ ok: false, mensagem: e.message });
    }
  }
  gravar(restantes);
  return { enviados: fila.length - restantes.length, respostas };
}

export function ouvirConexao(callback: () => void) {
  window.addEventListener('online', callback);
  return () => window.removeEventListener('online', callback);
}
