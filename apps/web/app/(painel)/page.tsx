'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { usePainel } from '@/components/Painel';
import { ComparativoEventos } from '@/components/ComparativoEventos';

export default function Inicio() {
  const { me, pode } = usePainel();
  const [bi, setBi] = useState<any>(null);
  const [eventos, setEventos] = useState<any[]>([]);

  useEffect(() => {
    if (pode('BI')) api('/bi/indicadores').then(setBi).catch(() => undefined);
    if (pode('M4')) api('/eventos?status=planejamento,confirmado,em_execucao,encerrado').then(setEventos).catch(() => undefined);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const mes = bi?.mensal?.[0];
  const ocup = bi?.ocupacao?.[0];
  const emRisco = eventos.filter((e) => e.vagas_abertas > 0 && new Date(e.inicio).getTime() - Date.now() < 3 * 86400_000);

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

      {emRisco.length > 0 && (
        <div className="aviso" style={{ marginBottom: 16 }}>
          {emRisco.length} evento(s) nos próximos 3 dias ainda com vaga aberta: {emRisco.map((e) => e.nome).join(', ')}
        </div>
      )}

      <div className="grade g2">
        {pode('M4') && (
          <section className="cartao">
            <h2>Próximos eventos</h2>
            {eventos.length === 0 && <p className="suave">Nenhum evento em andamento.</p>}
            <table>
              <tbody>
                {eventos.slice(0, 8).map((e) => (
                  <tr key={e.id}>
                    <td>
                      <Link href={`/eventos/${e.id}`}><strong>{e.nome}</strong></Link>
                      <div className="suave pequeno">{e.cliente} · {e.praca} · {fmt.dataHora(e.inicio)}</div>
                    </td>
                    <td style={{ width: 140 }}>
                      <div className="pequeno">{e.confirmados}/{e.vagas} confirmados</div>
                      <div className="barra"><div style={{ width: `${e.vagas ? (100 * e.confirmados) / e.vagas : 0}%` }} /></div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

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
