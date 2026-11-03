'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { CORES_CABELO, mascara, TIPOS_CABELO } from '@/lib/ui';
import { ExigeModulo, usePainel, Voltar } from '@/components/Painel';

/**
 * Relatório do evento para imprimir ou enviar: dados do evento, local e equipe escalada.
 * Não mostra NENHUM valor (diárias, receita, custo ou margem), mesmo para quem tem permissão de vê-los:
 * os campos exibidos são escolhidos um a um, nunca o objeto inteiro.
 */
export default function RelatorioEvento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ExigeModulo modulo="M4"><Relatorio id={id} /></ExigeModulo>;
}

const NOME_STATUS: Record<string, string> = {
  planejamento: 'Planejamento', confirmado: 'Confirmado', em_execucao: 'Em execução', encerrado: 'Encerrado', fechado: 'Fechado', cancelado: 'Cancelado',
};
const NOME_ALOCACAO: Record<string, string> = { convidado: 'Aguardando resposta', confirmado: 'Confirmado' };
const NOME_PRESENCA: Record<string, string> = { presente: 'Presente', falta: 'Falta', falta_justificada: 'Falta justificada' };
const NIVEL = ['', 'Júnior', 'Pleno', 'Sênior'];

/** Requisitos do posto em texto ("Altura a partir de 170 cm · Inglês · CNH") */
function requisitos(r: any = {}) {
  const t: string[] = [];
  if (r.altura_min && r.altura_max) t.push(`Altura de ${r.altura_min} a ${r.altura_max} cm`);
  else if (r.altura_min) t.push(`Altura a partir de ${r.altura_min} cm`);
  else if (r.altura_max) t.push(`Altura até ${r.altura_max} cm`);
  if (r.idade_min && r.idade_max) t.push(`De ${r.idade_min} a ${r.idade_max} anos`);
  else if (r.idade_min) t.push(`A partir de ${r.idade_min} anos`);
  else if (r.idade_max) t.push(`Até ${r.idade_max} anos`);
  if (r.generos?.length) t.push(`Gênero: ${r.generos.join(', ')}`);
  if (r.idiomas?.length) t.push(`Idiomas: ${r.idiomas.join(', ')}`);
  if (r.exige_cnh) t.push('CNH');
  if (r.locomocao?.length) t.push(`Locomoção: ${r.locomocao.map((m: string) => m.replaceAll('_', ' ')).join(', ')}`);
  if (r.tamanhos_camiseta?.length) t.push(`Camiseta: ${r.tamanhos_camiseta.join(', ')}`);
  if (r.nivel_min) t.push(`Nível mínimo: ${NIVEL[r.nivel_min]}`);
  if (r.cabelo_tipos?.length) t.push(`Cabelo: ${r.cabelo_tipos.map((c: string) => TIPOS_CABELO[c] ?? c).join(', ')}`);
  if (r.cabelo_cores?.length) t.push(`Cor do cabelo: ${r.cabelo_cores.map((c: string) => CORES_CABELO[c] ?? c).join(', ')}`);
  return t.join(' · ');
}

function Relatorio({ id }: { id: string }) {
  const { me, pode } = usePainel();
  const [ev, setEv] = useState<any>(null);
  const [escala, setEscala] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [comCelular, setComCelular] = useState(false);
  const [comSuplentes, setComSuplentes] = useState(true);
  const verEscala = pode('M5');

  useEffect(() => {
    Promise.all([api(`/eventos/${id}`), verEscala ? api<any[]>(`/eventos/${id}/escala`) : Promise.resolve(null)])
      .then(([e, es]) => { setEv(e); setEscala(es); })
      .catch((e) => setErro(e.message));
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!ev) return <div className="suave">Carregando…</div>;

  // só quem está (ou estava) na equipe: recusados, cancelados e substituídos não entram
  const equipe = (escala ?? []).filter((a) => ['convidado', 'confirmado'].includes(a.status) && (comSuplentes || a.tipo === 'titular'));
  const temPresenca = equipe.some((a) => (a.presenca && a.presenca !== 'previsto') || a.checkin_em);
  const inicio = ev.turnos[0]?.inicio;
  const fim = ev.turnos.reduce((m: string | null, t: any) => (!m || t.fim > m ? t.fim : m), null);
  const vagas = ev.turnos.reduce((s: number, t: any) => s + t.postos.reduce((x: number, p: any) => x + Number(p.quantidade), 0), 0);
  const confirmados = equipe.filter((a) => a.tipo === 'titular' && a.status === 'confirmado').length;
  const linha = (rotulo: string, valor: React.ReactNode) => (valor ? <tr><th style={{ width: '28%' }}>{rotulo}</th><td>{valor}</td></tr> : null);

  return (
    <div className="relatorio">
      <Voltar para={`/eventos/${id}`} />
      <div className="topo nao-imprimir">
        <div><div className="suave pequeno"><Link href="/eventos">Eventos</Link> / <Link href={`/eventos/${id}`}>{ev.nome}</Link> / Relatório</div>
          <h1>Relatório do evento</h1></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {verEscala && <>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={comSuplentes} onChange={(e) => setComSuplentes(e.target.checked)} /> Suplentes</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={comCelular} onChange={(e) => setComCelular(e.target.checked)} /> Celular dos profissionais</label>
          </>}
          <button className="btn primario" onClick={() => window.print()}>Imprimir / salvar PDF</button>
        </div>
      </div>

      <div className="cartao">
        <div className="cabecalho-relatorio">
          <div>
            <h1 style={{ margin: 0 }}>{ev.nome}</h1>
            <div className="suave pequeno">{me.empresa.nome} · emitido em {fmt.dataHora(new Date())} por {me.usuario.nome}</div>
          </div>
          <span className="etiqueta">{NOME_STATUS[ev.status] ?? ev.status}</span>
        </div>

        <section>
          <h2>Dados do evento</h2>
          <table><tbody>
            {linha('Cliente', ev.cliente)}
            {linha('Marca', ev.marca)}
            {linha('Período', inicio && `${fmt.dataHora(inicio)} a ${fmt.dataHora(fim)}`)}
            {linha('Praça', ev.praca)}
            {linha('Descrição', ev.descricao && <span style={{ whiteSpace: 'pre-wrap' }}>{ev.descricao}</span>)}
            {linha('Supervisão', ev.supervisores?.map((s: any) => s.nome).join(', '))}
            {linha('Check-in', [ev.exige_qr && 'QR code no local', ev.exige_geolocalizacao && `localização (raio de ${ev.raio_geo_m ?? '—'} m)`,
              ev.exige_selfie && 'selfie', `tolerância de ${ev.tolerancia_atraso_min ?? 0} min de atraso`].filter(Boolean).join(' · '))}
            {linha('Equipe', verEscala ? `${confirmados} de ${vagas} vaga(s) confirmada(s)` : `${vagas} vaga(s)`)}
          </tbody></table>
        </section>

        <section>
          <h2>Local</h2>
          <table><tbody>
            {linha('Local', ev.local_nome ?? 'Não informado')}
            {linha('Endereço', [ev.endereco, ev.cep && `CEP ${mascara.cep(ev.cep)}`].filter(Boolean).join(' · '))}
            {linha('Contato no local', [ev.contato_local_nome, ev.contato_local_telefone && mascara.telefone(ev.contato_local_telefone), ev.contato_local_email].filter(Boolean).join(' · '))}
            {linha('Observações', ev.observacoes && <span style={{ whiteSpace: 'pre-wrap' }}>{ev.observacoes}</span>)}
          </tbody></table>
        </section>

        {ev.turnos.map((t: any) => {
          const doTurno = equipe.filter((a) => a.turno_id === t.id);
          return (
            <section key={t.id}>
              <h2>{t.nome} <span className="suave pequeno" style={{ fontWeight: 400 }}>· {fmt.diaSemana(t.inicio)}, {fmt.hora(t.inicio)} às {fmt.hora(t.fim)}</span></h2>
              {t.postos.map((p: any) => {
                const doPosto = doTurno.filter((a) => a.posto_id === p.id).sort((a, b) => (a.tipo === b.tipo ? a.profissional.localeCompare(b.profissional) : a.tipo === 'titular' ? -1 : 1));
                const req = requisitos(p.requisitos);
                return (
                  <div key={p.id} style={{ marginBottom: 12, breakInside: 'avoid' }}>
                    <div><strong>{p.funcao}</strong> · {p.quantidade} vaga(s)
                      {verEscala && <span className="suave"> · {doPosto.filter((a) => a.tipo === 'titular' && a.status === 'confirmado').length} confirmado(s)</span>}</div>
                    {(p.uniforme || req) && <div className="suave pequeno">{[p.uniforme && `Uniforme: ${p.uniforme}`, req].filter(Boolean).join(' · ')}</div>}
                    {verEscala && (doPosto.length === 0 ? <div className="suave pequeno" style={{ marginTop: 4 }}>Ninguém escalado.</div> : (
                      <table style={{ marginTop: 4 }}>
                        <thead><tr><th>Profissional</th>{comCelular && <th>Celular</th>}<th>Escala</th><th>Situação</th>{temPresenca && <th>Presença</th>}</tr></thead>
                        <tbody>
                          {doPosto.map((a) => (
                            <tr key={a.id}>
                              <td>{a.profissional}</td>
                              {comCelular && <td style={{ whiteSpace: 'nowrap' }}>{mascara.telefone(a.celular?.replace(/^\+55/, ''))}</td>}
                              <td>{a.tipo === 'titular' ? 'Titular' : 'Suplente'}</td>
                              <td>{NOME_ALOCACAO[a.status] ?? a.status}</td>
                              {temPresenca && <td>{NOME_PRESENCA[a.presenca] ?? '—'}{a.atraso_min > 0 && ` (${a.atraso_min} min de atraso)`}
                                {a.checkin_em && <span className="suave"> · entrada {fmt.hora(a.checkin_em)}{a.checkout_em && `, saída ${fmt.hora(a.checkout_em)}`}</span>}</td>}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ))}
                  </div>
                );
              })}
            </section>
          );
        })}

        {!verEscala && <p className="suave pequeno">A lista de profissionais escalados aparece para quem tem acesso à Escala.</p>}
      </div>
    </div>
  );
}
