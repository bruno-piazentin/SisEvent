'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { ExigeModulo } from '@/components/Painel';

/** Visão do supervisor: eventos de hoje e amanhã sob sua responsabilidade */
export default function Campo() {
  return <ExigeModulo modulo="M6"><Lista /></ExigeModulo>;
}

function Lista() {
  const [eventos, setEventos] = useState<any[]>([]);
  useEffect(() => {
    const de = new Date(); de.setHours(0, 0, 0, 0);
    const ate = new Date(de.getTime() + 2 * 86400_000);
    api(`/eventos?status=confirmado,em_execucao,encerrado&de=${de.toISOString()}&ate=${ate.toISOString()}`).then(setEventos);
  }, []);

  return (
    <>
      <div className="topo"><div><h1>Campo</h1><div className="suave">Eventos de hoje e amanhã</div></div></div>
      {eventos.length === 0 && <div className="cartao suave">Nenhum evento sob sua responsabilidade nos próximos dois dias.</div>}
      <div className="grade g2">
        {eventos.map((e) => (
          <div className="cartao" key={e.id}>
            <h2>{e.nome}</h2>
            <div className="suave">{e.praca} · {fmt.dataHora(e.inicio)} – {fmt.hora(e.fim)}</div>
            <div style={{ margin: '10px 0' }}>{e.confirmados}/{e.vagas} confirmados</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <a className="btn campo" href={`/qr/${e.id}`} target="_blank" rel="noreferrer">QR de check-in</a>
              <Link className="btn" href={`/eventos/${e.id}`}>Presença e ocorrências</Link>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
