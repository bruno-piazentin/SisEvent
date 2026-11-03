/**
 * Prazo dos eventos ("shelf life"): em que faixa cada evento cai, conforme a distância até o início.
 * Os limites e as cores vêm do cadastro da empresa (tenant.prazos_eventos).
 */
export type Faixa = 'encerrado' | 'hoje' | 'proximo' | 'medio' | 'distante' | 'cancelado';

export interface Prazos {
  ate_dias: number;          // "até 5 dias"
  medio_ate_dias: number;    // "de 5 a 15 dias"; acima disso, "mais de 15"
  historico_dias: number;    // encerrados e cancelados: só os dos últimos N dias
  cores: Record<Faixa, string>;
}

export const PRAZOS_PADRAO: Prazos = {
  ate_dias: 5,
  medio_ate_dias: 15,
  historico_dias: 30,
  cores: { encerrado: '#1f1d22', hoje: '#f57c00', proximo: '#f2c200', medio: '#2e9d57', distante: '#2f6fdb', cancelado: '#d32f2f' },
};

export const FAIXAS: Faixa[] = ['encerrado', 'hoje', 'proximo', 'medio', 'distante', 'cancelado'];

export function nomeFaixa(f: Faixa, p: Prazos) {
  return {
    encerrado: 'Encerrados',
    hoje: 'Hoje',
    proximo: `Até ${p.ate_dias} dias`,
    medio: `De ${p.ate_dias + 1} a ${p.medio_ate_dias} dias`,
    distante: `Mais de ${p.medio_ate_dias} dias`,
    cancelado: 'Cancelados',
  }[f];
}

/** AAAA-MM-DD no fuso de São Paulo */
const diaSP = (d: string | Date) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400_000);

/** Faixa do evento; null quando não há data (evento sem turno) */
export function faixaDoEvento(e: { status: string; inicio?: string | null; fim?: string | null }, p: Prazos, agora = new Date()): Faixa | null {
  if (e.status === 'cancelado') return 'cancelado';
  if (e.status === 'encerrado' || e.status === 'fechado') return 'encerrado';
  if (e.status === 'em_execucao') return 'hoje';
  if (!e.inicio) return null;
  const hoje = diaSP(agora);
  const dias = diasEntre(hoje, diaSP(e.inicio));
  if (dias < 0) {
    // começou antes de hoje: se ainda não terminou, está acontecendo
    return e.fim && new Date(e.fim) >= agora ? 'hoje' : 'encerrado';
  }
  if (dias === 0) return 'hoje';
  if (dias <= p.ate_dias) return 'proximo';
  if (dias <= p.medio_ate_dias) return 'medio';
  return 'distante';
}

/** A partir de quando buscar eventos para os cards (encerrados e cancelados só do histórico configurado) */
export function inicioJanela(p: Prazos) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() - p.historico_dias * 86400_000);
}
