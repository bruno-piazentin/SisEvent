'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { baixarCsv } from '@/lib/ui';
import { ExigeModulo, usePainel, Voltar } from '@/components/Painel';

export default function RelatorioFinanceiro() {
  return <ExigeModulo modulo="M7" acao="ver_valores"><Relatorio /></ExigeModulo>;
}

/** AAAA-MM-DD no fuso de São Paulo */
const diaSP = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const n = (v: unknown) => Number(v ?? 0);
const custo = (e: any) => n(e.custo_equipe) + n(e.custos_diretos);
const pct = (margem: number, receita: number) => (receita ? Math.round((10000 * margem) / receita) / 100 : null);
const corMargem = (p: number | null) => (p === null ? undefined : p < 25 ? 'var(--erro)' : 'var(--ok)');
const dinheiroCsv = (v: number) => v.toFixed(2).replace('.', ',');

function Relatorio() {
  const { me } = usePainel();
  const hoje = diaSP(new Date());
  const [de, setDe] = useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = useState(() => { const [a, m] = hoje.split('-').map(Number); return diaSP(new Date(Date.UTC(a, m, 0, 12))); });
  const [cliente, setCliente] = useState('');
  const [situacao, setSituacao] = useState<'todos' | 'realizados' | 'previstos'>('todos');
  const [dados, setDados] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!de || !ate) return;
    setDados(null); setErro('');
    const q = new URLSearchParams({ de: `${de}T00:00:00-03:00`, ate: `${ate}T23:59:59-03:00` });
    api<any>(`/margem?${q}`).then((r) => setDados(r.eventos)).catch((e) => { setErro(e.message); setDados([]); });
  }, [de, ate]);

  const clientes = [...new Map((dados ?? []).map((e) => [e.cliente_id, e.cliente])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
  const lista = (dados ?? [])
    .filter((e) => !cliente || e.cliente_id === cliente)
    .filter((e) => situacao === 'todos' || (situacao === 'realizados' ? e.realizado : !e.realizado))
    .sort((a, b) => String(a.inicio).localeCompare(String(b.inicio)));
  const total = lista.reduce((s, e) => ({ receita: s.receita + n(e.receita), custo: s.custo + custo(e), margem: s.margem + n(e.margem) }), { receita: 0, custo: 0, margem: 0 });
  const porCliente = Object.values(lista.reduce((acc: Record<string, any>, e) => {
    const c = (acc[e.cliente_id] ??= { cliente: e.cliente, eventos: 0, receita: 0, custo: 0, margem: 0 });
    c.eventos++; c.receita += n(e.receita); c.custo += custo(e); c.margem += n(e.margem);
    return acc;
  }, {})).sort((a: any, b: any) => b.receita - a.receita) as any[];

  function exportar() {
    baixarCsv(`financeiro-eventos-${de}-a-${ate}.csv`, [
      ['Evento', 'Data', 'Cliente', 'Marca', 'Situação', 'Receita', 'Custo da equipe', 'Custos diretos', 'Custo total', 'Margem', 'Margem %'],
      ...lista.map((e) => [e.evento, fmt.data(e.inicio), e.cliente, e.marca ?? '', e.realizado ? 'realizado' : 'previsto',
        dinheiroCsv(n(e.receita)), dinheiroCsv(n(e.custo_equipe)), dinheiroCsv(n(e.custos_diretos)), dinheiroCsv(custo(e)),
        dinheiroCsv(n(e.margem)), e.margem_pct == null ? '' : String(e.margem_pct).replace('.', ',')]),
      ['Total', '', '', '', `${lista.length} evento(s)`, dinheiroCsv(total.receita), '', '', dinheiroCsv(total.custo), dinheiroCsv(total.margem),
        String(pct(total.margem, total.receita) ?? '').replace('.', ',')],
    ]);
  }

  const nomeCliente = cliente ? clientes.find(([id]) => id === cliente)?.[1] : null;
  const pctTotal = pct(total.margem, total.receita);

  return (
    <div className="relatorio">
      <Voltar para="/financeiro" />
      <div className="topo nao-imprimir">
        <div><div className="suave pequeno"><Link href="/financeiro">Financeiro</Link> / Relatório</div><h1>Relatório financeiro de eventos</h1></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportar} disabled={!lista.length}>Exportar planilha (CSV)</button>
          <button className="btn primario" onClick={() => window.print()} disabled={!lista.length}>Imprimir / salvar PDF</button>
        </div>
      </div>

      <div className="cartao nao-imprimir" style={{ marginBottom: 16 }}>
        <div className="filtros" style={{ marginBottom: 0 }}>
          <label>De<input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} /></label>
          <label>Até<input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} /></label>
          <label>Cliente
            <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
              <option value="">Todos</option>
              {clientes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            </select>
          </label>
          <label>Situação
            <select value={situacao} onChange={(e) => setSituacao(e.target.value as any)}>
              <option value="todos">Realizados e previstos</option><option value="realizados">Só realizados</option><option value="previstos">Só previstos</option>
            </select>
          </label>
        </div>
      </div>

      <div className="cartao">
        <div className="cabecalho-relatorio">
          <div>
            <h1 style={{ margin: 0 }}>Receita, custo e margem por evento</h1>
            <div className="suave pequeno">
              {fmt.data(`${de}T12:00:00Z`)} a {fmt.data(`${ate}T12:00:00Z`)}{nomeCliente && <> · {nomeCliente}</>}
              {situacao !== 'todos' && <> · só {situacao}</>} · {me.empresa.nome} · emitido em {fmt.dataHora(new Date())} por {me.usuario.nome}
            </div>
          </div>
        </div>

        {erro && <div className="aviso erro">{erro}</div>}
        {!dados && <p className="suave">Carregando…</p>}

        {dados && (
          <>
            <section className="grade g4" style={{ marginBottom: 16 }}>
              <div className="cartao kpi"><div className="rotulo">Eventos</div><div className="valor">{lista.length}</div></div>
              <div className="cartao kpi"><div className="rotulo">Receita</div><div className="valor">{fmt.moeda(total.receita)}</div></div>
              <div className="cartao kpi"><div className="rotulo">Custo</div><div className="valor">{fmt.moeda(total.custo)}</div></div>
              <div className="cartao kpi"><div className="rotulo">Margem</div><div className="valor">{fmt.moeda(total.margem)}</div>
                <div className="pequeno" style={{ color: corMargem(pctTotal) }}>{fmt.pct(pctTotal)} da receita</div></div>
            </section>

            {lista.length === 0 ? <p className="suave">Nenhum evento no período com esses filtros.</p> : (
              <>
                <section>
                  <h2>Eventos</h2>
                  <div className="tabela">
                    <table>
                      <thead><tr><th>Evento</th><th>Data</th><th>Cliente</th><th style={{ textAlign: 'right' }}>Receita</th><th style={{ textAlign: 'right' }}>Custo</th><th style={{ textAlign: 'right' }}>Margem</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
                      <tbody>
                        {lista.map((e) => (
                          <tr key={e.evento_id}>
                            <td><Link href={`/eventos/${e.evento_id}`}><strong>{e.evento}</strong></Link>
                              <div className="suave pequeno">{e.realizado ? 'realizado' : 'previsto'}</div></td>
                            <td style={{ whiteSpace: 'nowrap' }}>{fmt.data(e.inicio)}</td>
                            <td>{e.cliente}{e.marca && <div className="suave pequeno">{e.marca}</div>}</td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt.moeda(e.receita)}</td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt.moeda(custo(e))}
                              {n(e.custos_diretos) > 0 && <div className="suave pequeno">equipe {fmt.moeda(e.custo_equipe)} + diretos {fmt.moeda(e.custos_diretos)}</div>}</td>
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong>{fmt.moeda(e.margem)}</strong></td>
                            <td style={{ textAlign: 'right', color: corMargem(e.margem_pct == null ? null : n(e.margem_pct)) }}>{fmt.pct(e.margem_pct)}</td>
                          </tr>
                        ))}
                        <tr style={{ fontWeight: 700, borderTop: '2px solid var(--borda)' }}>
                          <td colSpan={3}>Total · {lista.length} evento(s)</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt.moeda(total.receita)}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt.moeda(total.custo)}</td>
                          <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt.moeda(total.margem)}</td>
                          <td style={{ textAlign: 'right', color: corMargem(pctTotal) }}>{fmt.pct(pctTotal)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                {!cliente && porCliente.length > 1 && (
                  <section>
                    <h2>Por cliente</h2>
                    <div className="tabela">
                      <table>
                        <thead><tr><th>Cliente</th><th>Eventos</th><th style={{ textAlign: 'right' }}>Receita</th><th style={{ textAlign: 'right' }}>Custo</th><th style={{ textAlign: 'right' }}>Margem</th><th style={{ textAlign: 'right' }}>%</th></tr></thead>
                        <tbody>
                          {porCliente.map((c) => {
                            const p = pct(c.margem, c.receita);
                            return (
                              <tr key={c.cliente}>
                                <td>{c.cliente}</td><td>{c.eventos}</td>
                                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt.moeda(c.receita)}</td>
                                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{fmt.moeda(c.custo)}</td>
                                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}><strong>{fmt.moeda(c.margem)}</strong></td>
                                <td style={{ textAlign: 'right', color: corMargem(p) }}>{fmt.pct(p)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}
                <p className="suave pequeno">Previsto: evento ainda não fechado, com receita e custo estimados pelos postos (quantidade × diária). Realizado: evento fechado, com os valores apurados no fechamento. Eventos cancelados não entram.</p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
