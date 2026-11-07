'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { usePainel } from '@/components/Painel';
import { ComparativoEventos } from '@/components/ComparativoEventos';
import { CardsPrazo } from '@/components/PrazoEventos';
import { CalendarioEventos } from '@/components/CalendarioEventos';
import { Faixa, faixaDoEvento, inicioJanela, PRAZOS_PADRAO } from '@/lib/prazos';

export default function Inicio() {
  const { me, pode } = usePainel();
  const [bi, setBi] = useState<any>(null);
  const [eventos, setEventos] = useState<any[]>([]);
  const [faixa, setFaixa] = useState<Faixa | null>(null);
  const prazos = me.empresa.prazos_eventos ?? PRAZOS_PADRAO;

  useEffect(() => {
    if (pode('BI')) api('/bi/indicadores').then(setBi).catch(() => undefined);
    if (pode('M4')) {
      const q = new URLSearchParams({ status: 'planejamento,confirmado,em_execucao,encerrado,fechado,cancelado', de: inicioJanela(prazos).toISOString() });
      api<any[]>(`/eventos?${q}`).then((evs) => setEventos(evs.map((e) => ({ ...e, faixa: faixaDoEvento(e, prazos) })))).catch(() => undefined);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mes = bi?.mensal?.[0];
  const ocup = bi?.ocupacao?.[0];

  return (
    <>
      <div className="topo">
        <div>
          <h1>Olá, {me.usuario.nome.split(' ')[0]}</h1>
          <div className="suave">{fmt.diaSemana(new Date())}</div>
        </div>
        {pode('M4', 'criar') && <Link className="btn primario" href="/eventos/novo">Novo evento</Link>}
      </div>

      {bi && (
        <section className="grade g4" style={{ marginBottom: 16 }}>
          <div className="cartao kpi"><div className="rotulo">Eventos no mês</div><div className="valor">{mes?.eventos ?? 0}</div>
            <div className="suave pequeno">{mes?.eventos_fechados ?? 0} fechados</div></div>
          {'receita' in (mes ?? {}) ? (
            <>
              <div className="cartao kpi"><div className="rotulo">Receita</div><div className="valor">{fmt.moeda(mes?.receita)}</div></div>
              <div className="cartao kpi"><div className="rotulo">Margem</div><div className="valor">{fmt.moeda(mes?.margem)}</div>
                <div className="suave pequeno">{fmt.pct(mes?.margem_pct)} da receita</div></div>
            </>
          ) : null}
          <div className="cartao kpi"><div className="rotulo">Faltas</div><div className="valor">{fmt.pct(mes?.taxa_falta_pct ?? 0)}</div>
            <div className="suave pequeno">sobre efetivo escalado</div></div>
          <div className="cartao kpi"><div className="rotulo">Ocupação da base</div><div className="valor">{fmt.pct(ocup?.ocupacao_pct ?? 0)}</div>
            <div className="suave pequeno">{ocup?.trabalharam ?? 0} de {ocup?.base_ativa ?? 0} ativos trabalharam</div></div>
        </section>
      )}

      {pode('M4') && <CardsPrazo eventos={eventos} prazos={prazos} selecionada={faixa} onSelecionar={setFaixa} />}

      {pode('M4') && (
        <div style={{ marginBottom: 16 }}>
          <CalendarioEventos prazos={prazos} faixa={faixa} eventosFaixa={faixa ? eventos.filter((e) => e.faixa === faixa) : []}
                             onLimparFaixa={() => setFaixa(null)} podeCriar={pode('M4', 'criar')} />
        </div>
      )}

      <div className="grade g2">
        {bi?.clientes?.length > 0 && (
          <section className="cartao">
            <h2>Margem por cliente</h2>
            <table>
              <thead><tr><th>Cliente</th><th>Eventos</th><th>Receita</th><th>Margem</th></tr></thead>
              <tbody>
                {bi.clientes.map((c: any) => (
                  <tr key={c.cliente}><td>{c.cliente}</td><td>{c.eventos}</td><td>{fmt.moeda(c.receita)}</td>
                    <td><span className={`etiqueta ${Number(c.margem_pct) >= 30 ? 'ok' : 'alerta'}`}>{fmt.pct(c.margem_pct)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {bi?.profissionais?.length > 0 && (
          <section className="cartao">
            <h2>Profissionais mais assíduos</h2>
            <table>
              <thead><tr><th>Nome</th><th>Jobs</th><th>Assiduidade</th><th>Nota</th></tr></thead>
              <tbody>
                {bi.profissionais.slice(0, 8).map((p: any) => (
                  <tr key={p.profissional_id}><td>{p.nome}</td><td>{p.jobs}</td><td>{fmt.pct(p.assiduidade_pct)}</td><td>{p.nota_media ?? '—'}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>

      {pode('M4') && <div style={{ marginTop: 16 }}><ComparativoEventos /></div>}

      {bi && <p className="suave pequeno" style={{ marginTop: 16 }}>Indicadores atualizados em {fmt.dataHora(bi.atualizado_em)}</p>}
    </>
  );
}
