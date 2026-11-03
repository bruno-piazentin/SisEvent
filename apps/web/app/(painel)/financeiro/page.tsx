'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { ExigeModulo, usePainel } from '@/components/Painel';

export default function Financeiro() {
  return <ExigeModulo modulo="M7"><Conteudo /></ExigeModulo>;
}

function Conteudo() {
  const { pode } = usePainel();
  const [margem, setMargem] = useState<any>(null);
  const [pagamentos, setPagamentos] = useState<any[]>([]);
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [lote, setLote] = useState<any>(null);

  const carregar = () => {
    if (pode('M7', 'ver_valores')) api('/margem').then(setMargem);
    api('/pagamentos?status=pendente').then(setPagamentos);
  };
  useEffect(carregar, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function gerarLote() {
    const r = await api('/lotes-pagamento', { method: 'POST', json: {
      descricao: `Lote ${new Date().toLocaleDateString('pt-BR')}`, data_prevista: new Date().toISOString(), pagamentos: selecionados } });
    setLote(r); setSelecionados([]); carregar();
  }

  function baixarCsv() {
    const url = URL.createObjectURL(new Blob(['﻿' + lote.csv], { type: 'text/csv;charset=utf-8' }));
    Object.assign(document.createElement('a'), { href: url, download: `lote-pix-${lote.lote_id.slice(0, 8)}.csv` }).click();
  }

  const totalSel = pagamentos.filter((p) => selecionados.includes(p.id)).reduce((s, p) => s + Number(p.valor), 0);

  return (
    <>
      <div className="topo">
        <h1>Financeiro</h1>
        {pode('M7', 'ver_valores') && <Link className="btn" href="/financeiro/relatorio">Relatório</Link>}
      </div>

      {margem && (
        <div className="grade g2" style={{ marginBottom: 16 }}>
          <section className="cartao">
            <h2>Margem por evento</h2>
            <div className="tabela"><table>
              <thead><tr><th>Evento</th><th>Receita</th><th>Custo</th><th>Margem</th></tr></thead>
              <tbody>
                {margem.eventos.map((e: any) => (
                  <tr key={e.evento_id}>
                    <td><Link href={`/eventos/${e.evento_id}`}>{e.evento}</Link><div className="suave pequeno">{e.cliente} · {fmt.data(e.inicio)} · {e.realizado ? 'realizado' : 'previsto'}</div></td>
                    <td>{fmt.moeda(e.receita)}</td><td>{fmt.moeda(Number(e.custo_equipe) + Number(e.custos_diretos))}</td>
                    <td><strong>{fmt.moeda(e.margem)}</strong><div className={`pequeno`} style={{ color: Number(e.margem_pct) < 25 ? 'var(--erro)' : 'var(--ok)' }}>{fmt.pct(e.margem_pct)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
          <section className="cartao">
            <h2>Por cliente</h2>
            <table>
              <thead><tr><th>Cliente</th><th>Eventos</th><th>Receita</th><th>Margem</th></tr></thead>
              <tbody>
                {margem.por_cliente.map((c: any) => (
                  <tr key={c.cliente}><td>{c.cliente}</td><td>{c.eventos}</td><td>{fmt.moeda(c.receita)}</td><td>{fmt.moeda(c.margem)} <span className="suave pequeno">{fmt.pct(c.margem_pct)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}

      <section className="cartao">
        <div className="topo" style={{ marginBottom: 8 }}>
          <h2>Pagamentos pendentes</h2>
          {pode('M7', 'aprovar') && pode('DP') && <button className="btn primario" disabled={!selecionados.length} onClick={gerarLote}>
            Gerar lote PIX ({selecionados.length}) {selecionados.length > 0 && fmt.moeda(totalSel)}</button>}
        </div>
        {lote && <div className="aviso ok" style={{ marginBottom: 10 }}>Lote com {lote.quantidade} pagamento(s), total {fmt.moeda(lote.total)}. <button className="btn pequeno" onClick={baixarCsv}>Baixar CSV</button></div>}
        {pagamentos.length === 0 && <p className="suave">Nada pendente. Os valores aparecem aqui quando um evento é fechado.</p>}
        <div className="tabela"><table>
          <tbody>
            {pagamentos.map((p) => (
              <tr key={p.id}>
                <td style={{ width: 30 }}><input type="checkbox" style={{ width: 'auto' }} checked={selecionados.includes(p.id)}
                  onChange={(e) => setSelecionados((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} /></td>
                <td>{p.profissional}<div className="suave pequeno">{p.forma_contratacao ?? '—'}{'chave_pix' in p && ` · PIX ${p.chave_pix ?? 'não cadastrado'}`}</div></td>
                <td className="pequeno">{p.evento}<div className="suave">{fmt.data(p.data_evento)}</div></td>
                <td><strong>{fmt.moeda(p.valor)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </>
  );
}
