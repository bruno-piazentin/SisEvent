'use client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export class ErroApi extends Error {
  constructor(public status: number, public codigo: string, mensagem: string, public dados?: any) {
    super(mensagem);
  }
}

const CHAVE_SESSAO = 'sisevent.sessao';

export interface Sessao {
  token: string;
  usuario: { id: string; nome: string; perfil: string };
}

export function sessao(): Sessao | null {
  try {
    const s = localStorage.getItem(CHAVE_SESSAO);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export function salvarSessao(s: Sessao | null) {
  try {
    if (s) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(s));
    else localStorage.removeItem(CHAVE_SESSAO);
  } catch { /* navegação privada */ }
}

/** Chamada à API interna (com login). Lança ErroApi com a mensagem pronta para a tela. */
export async function api<T = any>(caminho: string, opcoes: RequestInit & { json?: unknown; motivo?: string } = {}): Promise<T> {
  const s = sessao();
  const headers: Record<string, string> = { ...(opcoes.headers as Record<string, string>) };
  if (s) headers.Authorization = `Bearer ${s.token}`;
  if (opcoes.json !== undefined) headers['Content-Type'] = 'application/json';
  if (opcoes.motivo) headers['X-Motivo'] = opcoes.motivo;

  const res = await fetch(`${API_URL}${caminho}`, {
    ...opcoes,
    headers,
    body: opcoes.json !== undefined ? JSON.stringify(opcoes.json) : opcoes.body,
  });
  if (res.status === 401 && s) {
    salvarSessao(null);
    if (typeof window !== 'undefined') window.location.href = '/login';
  }
  const corpo = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new ErroApi(res.status, corpo?.codigo ?? 'erro', corpo?.mensagem ?? 'Erro na requisição', corpo);
  }
  return corpo as T;
}

/** Baixa um arquivo protegido (ex.: foto do local) e devolve uma URL local para <img> */
export async function apiArquivoUrl(caminho: string): Promise<string> {
  const s = sessao();
  const res = await fetch(`${API_URL}${caminho}`, { headers: s ? { Authorization: `Bearer ${s.token}` } : {} });
  if (!res.ok) throw new ErroApi(res.status, 'erro', 'Não foi possível carregar o arquivo');
  return URL.createObjectURL(await res.blob());
}

/** Chamada da área pública do profissional (sem login, identificado pelo token do link). */
export async function apiPublica<T = any>(caminho: string, json?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/publico${caminho}`, {
    method: json === undefined ? 'GET' : 'POST',
    headers: json === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const corpo = await res.json().catch(() => ({}));
  if (!res.ok) throw new ErroApi(res.status, corpo?.codigo ?? 'erro', corpo?.mensagem ?? 'Falha de comunicação', corpo);
  return corpo as T;
}

// ---- formatação pt-BR ----
const tz = 'America/Sao_Paulo';
export const fmt = {
  data: (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: tz }) : '—'),
  hora: (d?: string | Date | null) => (d ? new Date(d).toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }) : '—'),
  dataHora: (d?: string | Date | null) =>
    d ? new Date(d).toLocaleString('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—',
  diaSemana: (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('pt-BR', { timeZone: tz, weekday: 'long', day: '2-digit', month: 'long' }) : '—'),
  moeda: (v?: number | string | null) =>
    v === null || v === undefined ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
  pct: (v?: number | string | null) => (v === null || v === undefined ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`),
};

export const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
