'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { COR_STATUS } from '@/lib/ui';
import { CorPrazo } from '@/components/PrazoEventos';
import { Faixa, faixaDoEvento, nomeFaixa, Prazos } from '@/lib/prazos';

const STATUS = 'planejamento,confirmado,em_execucao,encerrado,fechado,cancelado';
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** AAAA-MM-DD no fuso de São Paulo */
const diaSP = (d: string | Date) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const nomeDia = (dia: string) => new Date(`${dia}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'long', day: '2-digit', month: 'long' });

/** Dias (AAAA-MM-DD) em que o evento acontece, do primeiro ao último turno */
function diasDoEvento(e: { inicio?: string | null; fim?: string | null }) {
  if (!e.inicio) return [];
  const ate = diaSP(e.fim ?? e.inicio);
  const dias: string[] = [];
  for (let d = diaSP(e.inicio); d <= ate && dias.length < 62; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

/** Horário do evento: só as horas quando começa e termina no mesmo dia */
function horario(e: { inicio?: string | null; fim?: string | null }) {
  if (!e.inicio) return 'Sem turno';
  if (!e.fim) return fmt.dataHora(e.inicio);
  return diaSP(e.inicio) === diaSP(e.fim) ? `${fmt.hora(e.inicio)} às ${fmt.hora(e.fim)}` : `${fmt.dataHora(e.inicio)} a ${fmt.dataHora(e.fim)}`;
}

/**
 * Calendário do mês com os eventos marcados na cor do prazo. Clicar num dia lista os eventos dele.
 * Com um card de prazo selecionado, marca só os eventos daquela faixa e a lista mostra a faixa inteira.
 */
export function CalendarioEventos({ prazos, faixa, eventosFaixa, onLimparFaixa, podeCriar }: {
  prazos: Prazos;
  podeCriar: boolean;
  faixa: Faixa | null;
  eventosFaixa: any[];
  onLimparFaixa: () => void;
}) {
  const hoje = diaSP(new Date());
  const [mes, setMes] = useState(hoje.slice(0, 7)); // AAAA-MM
  const [dia, setDia] = useState(hoje);
  const [eventos, setEventos] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);

  // a grade começa no domingo antes do dia 1 e vai até o sábado depois do último dia
  const grade = useMemo(() => {
    const primeiro = `${mes}-01`;
    const inicio = somarDias(primeiro, -new Date(`${primeiro}T12:00:00Z`).getUTCDay());
    const ultimo = somarDias(`${somarDias(primeiro, 32).slice(0, 7)}-01`, -1);
    const fim = somarDias(ultimo, 6 - new Date(`${ultimo}T12:00:00Z`).getUTCDay());
    const dias: string[] = [];
    for (let d = inicio; d <= fim; d = somarDias(d, 1)) dias.push(d);
    return dias;
  }, [mes]);

  useEffect(() => {
    setCarregando(true);
    const q = new URLSearchParams({ status: STATUS, de: `${grade[0]}T00:00:00-03:00`, ate: `${grade[grade.length - 1]}T23:59:59-03:00` });
    api<any[]>(`/eventos?${q}`)
      .then((evs) => setEventos(evs.map((e) => ({ ...e, faixa: faixaDoEvento(e, prazos), dias: diasDoEvento(e) }))))
      .catch(() => setEventos([]))
      .finally(() => setCarregando(false));
  }, [grade]); // eslint-disable-line react-hooks/exhaustive-deps

  const porDia = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of eventos) {
      if (faixa && e.faixa !== faixa) continue;
      for (const d of e.dias) m.set(d, [...(m.get(d) ?? []), e]);
    }
    return m;
  }, [eventos, faixa]);

  const mudarMes = (n: number) => {
    const [a, m] = mes.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1 + n, 1));
    setMes(d.toISOString().slice(0, 7));
  };
  const irHoje = () => { setMes(hoje.slice(0, 7)); setDia(hoje); onLimparFaixa(); };
  const escolher = (d: string) => { setDia(d); if (d.slice(0, 7) !== mes) setMes(d.slice(0, 7)); onLimparFaixa(); };

  const nomeMes = new Date(`${mes}-01T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  const lista = faixa ? eventosFaixa : (porDia.get(dia) ?? []);

  return (
    <section className="cartao calendario-eventos">
      <div className="cal-layout">
        <div>
          <div className="cal-topo">
            <button type="button" className="btn pequeno" onClick={() => mudarMes(-1)} aria-label="Mês anterior">‹</button>
            <h2 className="cal-mes">{nomeMes}</h2>
            <button type="button" className="btn pequeno" onClick={() => mudarMes(1)} aria-label="Próximo mês">›</button>
            <button type="button" className="btn pequeno" onClick={irHoje} disabled={mes === hoje.slice(0, 7) && dia === hoje && !faixa}>Hoje</button>
          </div>
          <div className="cal-grade" role="grid" aria-busy={carregando}>
            {SEMANA.map((s) => <div key={s} className="cal-semana" role="columnheader">{s}</div>)}
            {grade.map((d) => {
              const doDia = porDia.get(d) ?? [];
              const cores = [...new Set(doDia.map((e) => e.faixa).filter(Boolean))] as Faixa[];
              const classes = ['cal-dia', d.slice(0, 7) !== mes && 'fora', d === hoje && 'hoje', !faixa && d === dia && 'ativo', doDia.length && 'com-evento'];
              return (
                <button key={d} type="button" className={classes.filter(Boolean).join(' ')} onClick={() => escolher(d)}
                        aria-pressed={!faixa && d === dia}
                        aria-label={`${nomeDia(d)}: ${doDia.length ? `${doDia.length} evento(s)` : 'sem eventos'}`}>
                  <span className="cal-numero">{Number(d.slice(8))}</span>
                  {doDia.length > 0 && (
                    <span className="cal-marcas">
                      {cores.slice(0, 3).map((f) => <span key={f} className="cor-prazo" style={{ background: prazos.cores[f] }} />)}
                      {doDia.length > 1 && <span className="cal-qtd">{doDia.length}</span>}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="cal-lista">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <h2 style={{ textTransform: faixa ? undefined : 'capitalize' }}>{faixa ? <>Eventos · {nomeFaixa(faixa, prazos)}</> : nomeDia(dia)}</h2>
            {faixa ? <button className="btn pequeno" onClick={onLimparFaixa}>Ver o dia</button>
              : podeCriar && dia >= hoje && <Link className="btn primario pequeno" href={`/eventos/novo?data=${dia}`}>+ Novo evento neste dia</Link>}
          </div>
          {lista.length === 0 && <p className="suave">{carregando && !faixa ? 'Carregando…' : faixa ? 'Nenhum evento nesta faixa.' : 'Nenhum evento neste dia.'}</p>}
          <div className="cal-eventos">
            {lista.map((e) => (
              <Link key={e.id} href={`/eventos/${e.id}`} className="cal-evento" style={{ ['--cor' as any]: e.faixa ? prazos.cores[e.faixa as Faixa] : 'var(--borda)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                  <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><CorPrazo faixa={e.faixa} prazos={prazos} />{e.nome}</strong>
                  <span className={`etiqueta ${COR_STATUS[e.status] ?? ''}`}>{e.status.replace('_', ' ')}</span>
                </div>
                <div className="pequeno">{horario(e)}</div>
                <div className="suave pequeno">
                  {[e.cliente, e.marca, e.praca, e.local_nome].filter(Boolean).join(' · ')}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <div className="barra" style={{ flex: 1 }}><div style={{ width: `${e.vagas ? (100 * e.confirmados) / e.vagas : 0}%` }} /></div>
                  <span className="pequeno">{e.confirmados}/{e.vagas} confirmados</span>
                </div>
                {e.vagas_abertas > 0 && e.faixa !== 'encerrado' && e.faixa !== 'cancelado' &&
                  <div className="pequeno" style={{ color: 'var(--alerta)', fontWeight: 600 }}>{e.vagas_abertas} vaga(s) aberta(s)</div>}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
