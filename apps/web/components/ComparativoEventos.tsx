'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

// cancelados ficam fora da contagem
const STATUS_CONTADOS = 'planejamento,confirmado,em_execucao,encerrado,fechado';

/** AAAA-MM-DD no fuso de São Paulo */
const diaSP = (d: string | Date) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const chaveMes = (ano: number, mes: number) => `${ano}-${String(mes).padStart(2, '0')}`;
const ultimoDia = (ano: number, mes: number) => new Date(Date.UTC(ano, mes, 0)).getUTCDate();
const nomeMes = (ano: number, mes: number) =>
  new Date(Date.UTC(ano, mes - 1, 15)).toLocaleDateString('pt-BR', { timeZone: 'UTC', month: 'long' });

export function ComparativoEventos() {
  const router = useRouter();
  const hoje = diaSP(new Date());
  const [ano, mes] = hoje.split('-').map(Number);
  const anoAnt = mes === 1 ? ano - 1 : ano;
  const mesAnt = mes === 1 ? 12 : mes - 1;

  const [inicios, setInicios] = useState<string[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const [de, setDe] = useState(`${ano}-01-01`);
  const [ate, setAte] = useState(hoje);

  // últimos 12 meses, do mais antigo ao atual (a janela sempre cobre janeiro e o mês anterior)
  const meses = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - 12 + i, 1));
    return { ano: d.getUTCFullYear(), mes: d.getUTCMonth() + 1 };
  });

  useEffect(() => {
    const desde = `${chaveMes(meses[0].ano, meses[0].mes)}-01`;
    const q = new URLSearchParams({ status: STATUS_CONTADOS, de: `${desde}T00:00:00-03:00`, ate: `${ano}-12-31T23:59:59-03:00` });
    api<any[]>(`/eventos?${q}`)
      .then((evs) => setInicios(evs.filter((e) => e.inicio).map((e) => diaSP(e.inicio))))
      .catch(() => setInicios([]));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const contar = (prefixo: string) => (inicios ?? []).filter((d) => d.startsWith(prefixo)).length;
  const noMes = contar(chaveMes(ano, mes));
  const anterior = contar(chaveMes(anoAnt, mesAnt));
  const noAno = contar(`${ano}-`);
  const variacao = anterior ? (100 * (noMes - anterior)) / anterior : null;

  function atalho(d: string, a: string) { setDe(d); setAte(a); }
  function buscar() {
    if (!de || !ate || de > ate) return;
    router.push(`/eventos?${new URLSearchParams({ de, ate })}`);
  }

  return (
    <>
    <section className="cartao" style={{ marginBottom: 16 }}>
      <div role="button" tabIndex={0} title="Clique para buscar eventos por período" style={{ cursor: 'pointer' }}
           onClick={() => setAberto(!aberto)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setAberto(!aberto)}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Eventos</h2>
          <span className="suave pequeno">{aberto ? 'Fechar busca ▲' : 'Buscar por período ▼'}</span>
        </div>
        <div className="grade g4">
          <div className="kpi">
            <div className="rotulo">Este mês ({nomeMes(ano, mes)})</div>
            <div className="valor">{inicios ? noMes : '…'}</div>
            {inicios && (
              <span className={`etiqueta ${variacao === null ? 'neutra' : variacao > 0 ? 'ok' : variacao < 0 ? 'erro' : 'neutra'}`}>
                {variacao === null ? (noMes ? 'sem eventos no mês anterior' : 'igual ao mês anterior')
                  : `${variacao > 0 ? '▲ +' : variacao < 0 ? '▼ ' : ''}${variacao.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% vs mês anterior`}
              </span>
            )}
          </div>
          <div className="kpi">
            <div className="rotulo">Mês anterior ({nomeMes(anoAnt, mesAnt)})</div>
            <div className="valor">{inicios ? anterior : '…'}</div>
            {inicios && <div className="suave pequeno">{noMes - anterior >= 0 ? '+' : ''}{noMes - anterior} evento(s) de diferença</div>}
          </div>
          <div className="kpi">
            <div className="rotulo">Total no ano ({ano})</div>
            <div className="valor">{inicios ? noAno : '…'}</div>
            <div className="suave pequeno">sem contar cancelados</div>
          </div>
        </div>
      </div>

      {aberto && (
        <div style={{ borderTop: '1px solid var(--borda)', marginTop: 14, paddingTop: 14 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <button className="btn pequeno" onClick={() => atalho(`${chaveMes(ano, mes)}-01`, `${chaveMes(ano, mes)}-${ultimoDia(ano, mes)}`)}>Este mês</button>
            <button className="btn pequeno" onClick={() => atalho(`${chaveMes(anoAnt, mesAnt)}-01`, `${chaveMes(anoAnt, mesAnt)}-${ultimoDia(anoAnt, mesAnt)}`)}>Mês anterior</button>
            <button className="btn pequeno" onClick={() => atalho(`${ano}-01-01`, `${ano}-12-31`)}>Este ano</button>
          </div>
          <form className="filtros" style={{ marginBottom: 0 }} onSubmit={(e) => { e.preventDefault(); buscar(); }}>
            <label>De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} required /></label>
            <label>Até<input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} required /></label>
            <button className="btn primario" type="submit" disabled={!de || !ate || de > ate} style={{ flex: '0 0 auto' }}>Buscar eventos</button>
          </form>
          {de > ate && <p className="pequeno" style={{ color: 'var(--erro)' }}>A data final deve ser depois da inicial.</p>}
        </div>
      )}
    </section>
    <EvolucaoEventos carregado={!!inicios}
      meses={meses.map((m) => ({ ...m, total: contar(chaveMes(m.ano, m.mes)), atual: m.ano === ano && m.mes === mes }))}
      onMes={(m) => router.push(`/eventos?${new URLSearchParams({ de: `${chaveMes(m.ano, m.mes)}-01`, ate: `${chaveMes(m.ano, m.mes)}-${ultimoDia(m.ano, m.mes)}` })}`)} />
    </>
  );
}

type Mes = { ano: number; mes: number; total: number; atual: boolean };
const mesCurto = (m: Mes) =>
  `${nomeMes(m.ano, m.mes).slice(0, 3)}/${String(m.ano).slice(2)}`;

/** Gráfico de barras: eventos por mês nos últimos 12 meses. Clique numa barra abre os eventos do mês. */
function EvolucaoEventos({ meses, carregado, onMes }: { meses: Mes[]; carregado: boolean; onMes: (m: Mes) => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(640);
  const [foco, setFoco] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);

  useEffect(() => {
    if (!caixa.current) return;
    const obs = new ResizeObserver(([e]) => setLargura(Math.max(280, e.contentRect.width)));
    obs.observe(caixa.current);
    return () => obs.disconnect();
  }, [tabela]);

  const altura = 220, topo = 22, base = 28, esq = 28;
  const areaH = altura - topo - base;
  const maximo = Math.max(1, ...meses.map((m) => m.total));
  // eixo em números inteiros, com no máximo 4 divisões
  const passo = Math.max(1, Math.ceil(maximo / 4));
  const teto = passo * Math.ceil(maximo / passo);
  const ticks = Array.from({ length: teto / passo + 1 }, (_, i) => i * passo);
  const coluna = (largura - esq) / meses.length;
  const barra = Math.min(36, coluna - 2);
  const y = (v: number) => topo + areaH - (v / teto) * areaH;
  const total = meses.reduce((s, m) => s + m.total, 0);

  // barra com o topo arredondado (4px) e a base reta sobre o eixo
  const caminho = (x: number, v: number) => {
    const h = (v / teto) * areaH;
    if (h <= 0) return '';
    const r = Math.min(4, h, barra / 2), b = topo + areaH, t = b - h;
    return `M${x},${b} V${t + r} Q${x},${t} ${x + r},${t} H${x + barra - r} Q${x + barra},${t} ${x + barra},${t + r} V${b} Z`;
  };
  const f = foco !== null ? meses[foco] : null;

  return (
    <section className="cartao" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Evolução de eventos · últimos 12 meses</h2>
        <button className="btn pequeno" onClick={() => setTabela(!tabela)}>{tabela ? 'Ver gráfico' : 'Ver tabela'}</button>
      </div>
      <div className="suave pequeno" style={{ marginBottom: 8 }}>
        {carregado ? `${total} evento(s) no período · clique numa barra para ver os eventos do mês` : 'Carregando…'}
      </div>

      {tabela ? (
        <div className="tabela">
          <table>
            <thead><tr><th>Mês</th><th style={{ textAlign: 'right' }}>Eventos</th></tr></thead>
            <tbody>
              {[...meses].reverse().map((m) => (
                <tr key={`${m.ano}-${m.mes}`} style={{ cursor: 'pointer' }} onClick={() => onMes(m)}>
                  <td>{nomeMes(m.ano, m.mes)} de {m.ano}{m.atual && <span className="etiqueta" style={{ marginLeft: 6 }}>mês atual</span>}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{m.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={caixa} style={{ position: 'relative' }} onMouseLeave={() => setFoco(null)}>
          <svg width={largura} height={altura} role="img" style={{ display: 'block' }}
               aria-label={`Eventos por mês: ${meses.map((m) => `${mesCurto(m)} ${m.total}`).join(', ')}`}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={esq} x2={largura} y1={y(t)} y2={y(t)} stroke="var(--borda)" strokeWidth={1} />
                <text x={esq - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--suave)">{t}</text>
              </g>
            ))}
            {meses.map((m, i) => {
              const x = esq + i * coluna + (coluna - barra) / 2;
              const ativo = foco === null || foco === i;
              return (
                <g key={`${m.ano}-${m.mes}`} style={{ cursor: 'pointer' }}
                   onMouseEnter={() => setFoco(i)} onClick={() => onMes(m)}>
                  <rect x={esq + i * coluna} y={topo} width={coluna} height={areaH + base} fill="transparent" />
                  <path d={caminho(x, m.total)} fill="var(--primaria)" opacity={ativo ? 1 : 0.45} />
                  {m.atual && m.total > 0 && (
                    <text x={x + barra / 2} y={y(m.total) - 6} textAnchor="middle" fontSize={12} fontWeight={700} fill="var(--texto)">{m.total}</text>
                  )}
                  <text x={esq + i * coluna + coluna / 2} y={altura - 8} textAnchor="middle" fontSize={11}
                        fill={m.atual ? 'var(--texto)' : 'var(--suave)'} fontWeight={m.atual ? 700 : 400}>
                    {coluna < 40 ? nomeMes(m.ano, m.mes).slice(0, 1).toUpperCase() : mesCurto(m)}
                  </text>
                </g>
              );
            })}
            <line x1={esq} x2={largura} y1={topo + areaH} y2={topo + areaH} stroke="var(--suave)" strokeWidth={1} />
          </svg>
          {f && foco !== null && (
            <div className="cartao" style={{
              position: 'absolute', pointerEvents: 'none', padding: '6px 10px', whiteSpace: 'nowrap',
              top: Math.max(0, y(f.total) - 52),
              left: Math.min(Math.max(0, esq + foco * coluna + coluna / 2 - 70), largura - 150),
            }}>
              <div className="pequeno suave" style={{ textTransform: 'capitalize' }}>{nomeMes(f.ano, f.mes)} de {f.ano}</div>
              <strong>{f.total} evento(s)</strong>
              {foco > 0 && (() => {
                const ant = meses[foco - 1].total, d = f.total - ant;
                return <div className="pequeno suave">{d > 0 ? '+' : ''}{d} vs mês anterior</div>;
              })()}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
