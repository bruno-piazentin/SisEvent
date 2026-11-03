'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { ExigeModulo, usePainel } from '@/components/Painel';
import { CardsPrazo, CorPrazo } from '@/components/PrazoEventos';
import { Faixa, faixaDoEvento, inicioJanela, nomeFaixa, PRAZOS_PADRAO } from '@/lib/prazos';

/** Visão do supervisor: eventos sob sua responsabilidade, separados pelo prazo (abre em "Hoje") */
export default function Campo() {
  return <ExigeModulo modulo="M6"><Lista /></ExigeModulo>;
}

function Lista() {
  const { me } = usePainel();
  const prazos = me.empresa.prazos_eventos ?? PRAZOS_PADRAO;
  const [eventos, setEventos] = useState<any[] | null>(null);
  const [faixa, setFaixa] = useState<Faixa | null>('hoje');

  useEffect(() => {
    const q = new URLSearchParams({ status: 'planejamento,confirmado,em_execucao,encerrado,fechado,cancelado', de: inicioJanela(prazos).toISOString() });
    api<any[]>(`/eventos?${q}`).then((evs) => setEventos(evs.map((e) => ({ ...e, faixa: faixaDoEvento(e, prazos) }))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const lista = (eventos ?? []).filter((e) => (faixa ? e.faixa === faixa : e.faixa));

  return (
    <>
      <div className="topo"><div><h1>Campo</h1>
        <div className="suave">{faixa ? `Eventos · ${nomeFaixa(faixa, prazos)}` : 'Todos os eventos'} · clique num card para trocar</div></div></div>
      {eventos && <CardsPrazo eventos={eventos} prazos={prazos} selecionada={faixa} onSelecionar={setFaixa} />}
      {!eventos && <div className="cartao suave">Carregando…</div>}
      {eventos && lista.length === 0 && <div className="cartao suave">Nenhum evento sob sua responsabilidade nesta faixa.</div>}
      <div className="grade g2">
        {lista.map((e) => (
          <div className="cartao faixa-prazo" key={e.id} style={{ ['--cor' as any]: prazos.cores[e.faixa as Faixa] }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}><CorPrazo faixa={e.faixa} prazos={prazos} />{e.nome}</h2>
            <div className="suave">{e.praca} · {fmt.dataHora(e.inicio)} – {fmt.hora(e.fim)}</div>
            <div style={{ margin: '10px 0' }}>{e.confirmados}/{e.vagas} confirmados
              {e.vagas_abertas > 0 && e.faixa !== 'encerrado' && e.faixa !== 'cancelado' && <span style={{ color: 'var(--alerta)', fontWeight: 600 }}> · {e.vagas_abertas} vaga(s) aberta(s)</span>}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {e.faixa !== 'cancelado' && <a className="btn campo" href={`/qr/${e.id}`} target="_blank" rel="noreferrer">QR de check-in</a>}
              <Link className="btn" href={`/eventos/${e.id}`}>Presença e ocorrências</Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
