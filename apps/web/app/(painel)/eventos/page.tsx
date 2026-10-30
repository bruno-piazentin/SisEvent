'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, fmt } from '@/lib/api';
import { ExigeModulo, usePainel } from '@/components/Painel';
import { COR_STATUS } from '@/lib/ui';

export default function Eventos() {
  return <ExigeModulo modulo="M4"><Suspense><Lista /></Suspense></ExigeModulo>;
}

function Lista() {
  const { pode } = usePainel();
  const router = useRouter();
  const params = useSearchParams();
  // período vindo da busca da tela inicial (?de=AAAA-MM-DD&ate=AAAA-MM-DD)
  const [de, setDe] = useState(params.get('de') ?? '');
  const [ate, setAte] = useState(params.get('ate') ?? '');
  const [status, setStatus] = useState(params.get('de') || params.get('ate') ? '' : 'planejamento,confirmado,em_execucao,encerrado');
  const [eventos, setEventos] = useState<any[]>([]);

  useEffect(() => {
    if (de && ate && de > ate) return;
    const q = new URLSearchParams({ status });
    if (de) q.set('de', `${de}T00:00:00-03:00`);
    if (ate) q.set('ate', `${ate}T23:59:59-03:00`);
    api(`/eventos?${q}`).then(setEventos);
    const url = new URLSearchParams();
    if (de) url.set('de', de);
    if (ate) url.set('ate', ate);
    router.replace(url.size ? `/eventos?${url}` : '/eventos', { scroll: false });
  }, [status, de, ate]); // eslint-disable-line react-hooks/exhaustive-deps

  const periodo = de || ate ? ` · ${de ? fmt.data(`${de}T12:00:00-03:00`) : '…'} a ${ate ? fmt.data(`${ate}T12:00:00-03:00`) : '…'}` : '';

  return (
    <>
      <div className="topo">
        <div><h1>Eventos</h1><div className="suave">{eventos.length} evento(s){periodo}</div></div>
        {pode('M4', 'criar') && <Link className="btn primario" href="/eventos/novo">Novo evento</Link>}
      </div>
      <div className="cartao">
        <div className="filtros" style={{ maxWidth: 720 }}>
          <label>Situação
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="planejamento,confirmado,em_execucao,encerrado">Em aberto</option>
              <option value="fechado">Fechados</option>
              <option value="cancelado">Cancelados</option>
              <option value="">Todos</option>
            </select>
          </label>
          <label>De<input type="date" value={de} onChange={(e) => setDe(e.target.value)} /></label>
          <label>Até<input type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} /></label>
          {(de || ate) && <button className="btn" style={{ flex: '0 0 auto' }} onClick={() => { setDe(''); setAte(''); }}>Limpar período</button>}
        </div>
        {de && ate && de > ate && <p className="pequeno" style={{ color: 'var(--erro)' }}>A data final deve ser depois da inicial.</p>}
        <div className="tabela">
          <table>
            <thead><tr><th>Evento</th><th>Quando</th><th>Praça</th><th>Escala</th><th>Status</th></tr></thead>
            <tbody>
              {eventos.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/eventos/${e.id}`}><strong>{e.nome}</strong></Link><div className="suave pequeno">{e.cliente}{e.marca && ` · ${e.marca}`}</div></td>
                  <td className="pequeno">{fmt.dataHora(e.inicio)}<div className="suave">até {fmt.dataHora(e.fim)}</div></td>
                  <td>{e.praca}</td>
                  <td style={{ minWidth: 140 }}>
                    <div className="pequeno">{e.confirmados}/{e.vagas} confirmados{e.vagas_abertas > 0 && <span className="etiqueta alerta" style={{ marginLeft: 6 }}>{e.vagas_abertas} aberta(s)</span>}</div>
                    <div className="barra"><div style={{ width: `${e.vagas ? (100 * e.confirmados) / e.vagas : 0}%` }} /></div>
                  </td>
                  <td><span className={`etiqueta ${COR_STATUS[e.status]}`}>{e.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
