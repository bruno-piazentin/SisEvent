'use client';
import { apiPublica, ErroApi } from './api';
import { enfileirar } from './fila-offline';

export interface ResultadoPonto { ok: boolean; mensagem: string; offline?: boolean; erro?: string; [k: string]: any }

function localizacao(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60_000 },
    );
  });
}

/**
 * Registra entrada/saída. Sem internet (ou servidor fora), guarda na fila com a hora da leitura
 * e avisa a pessoa — a sincronização acontece sozinha quando o sinal voltar.
 */
export async function registrarPonto(p: {
  token: string; evento_id: string; tipo: 'checkin' | 'checkout'; codigo_qr?: string | null; pedirLocalizacao?: boolean;
}): Promise<ResultadoPonto> {
  const momento = new Date().toISOString();
  const geo = p.pedirLocalizacao ? await localizacao() : null;
  const corpo = {
    evento_id: p.evento_id, tipo: p.tipo, codigo_qr: p.codigo_qr ?? null,
    dispositivo_em: momento, lat: geo?.lat ?? null, lng: geo?.lng ?? null,
  };
  if (!navigator.onLine) {
    enfileirar({ token: p.token, ...corpo });
    return { ok: true, offline: true, mensagem: 'Sem internet: registro guardado no celular. Ele será enviado assim que o sinal voltar.' };
  }
  try {
    return await apiPublica<ResultadoPonto>(`/p/${p.token}/ponto`, corpo);
  } catch (e) {
    if (e instanceof ErroApi && e.status < 500 && e.status !== 429) {
      return { ok: false, mensagem: e.message };
    }
    enfileirar({ token: p.token, ...corpo });
    return { ok: true, offline: true, mensagem: 'Conexão instável: registro guardado no celular e será enviado automaticamente.' };
  }
}

/** Leitor de QR dentro da página (Android/Chrome). No iPhone, usar a câmera nativa ou digitar o código. */
export function leitorDisponivel(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window;
}

export async function lerQrDaCamera(video: HTMLVideoElement, sinal: AbortSignal): Promise<string | null> {
  const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  video.srcObject = stream;
  await video.play();
  try {
    while (!sinal.aborted) {
      const codigos = await detector.detect(video);
      if (codigos.length) return codigos[0].rawValue as string;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

/** Extrai evento e código de uma URL do QR (…/c/<evento>/<codigo>) */
export function interpretarQr(texto: string): { evento_id: string; codigo: string } | null {
  const m = texto.match(/\/c\/([0-9a-f-]{36})\/(\d{6})/i);
  return m ? { evento_id: m[1], codigo: m[2] } : null;
}
