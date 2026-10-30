'use client';
import { Suspense, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { COR_STATUS } from '@/lib/ui';
import { ExigeModulo, usePainel } from '@/components/Painel';
import { LocalEvento } from '@/components/LocalEvento';
import { useSearchParams } from 'next/navigation';

const COR_ALOCACAO: Record<string, string> = { convidado: 'alerta', confirmado: 'ok', recusado: 'erro', cancelado: 'neutra', substituido: 'neutra' };

export default function DetalheEvento({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ExigeModulo modulo="M4"><Suspense><Evento id={id} /></Suspense></ExigeModulo>;
}

function Evento({ id }: { id: string }) {
  const { pode } = usePainel();
  const [ev, setEv] = useState<any>(null);
  const [escala, setEscala] = useState<any[]>([]);
  const [aba, setAba] = useState<'escala' | 'campo' | 'fechamento'>('escala');
  const [erro, setErro] = useState('');
  const params = useSearchParams();

  const carregar = useCallback(async () => {
    try {
      const [e, es] = await Promise.all([api(`/eventos/${id}`), pode('M5') ? api(`/eventos/${id}/escala`) : Promise.resolve([])]);
      setEv(e); setEscala(es);
    } catch (e: any) { setErro(e.message); }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { carregar(); }, [carregar]);

  if (erro && !ev) return <div className="aviso erro">{erro}</div>;
  if (!ev) return <div className="suave">Carregando…</div>;

  return (
    <>
      <div className="topo">
        <div>
          <div className="suave pequeno"><Link href="/eventos">Eventos</Link> / {ev.cliente}</div>
          <h1>{ev.nome} <span className={`etiqueta ${COR_STATUS[ev.status]}`} style={{ verticalAlign: 'middle' }}>{ev.status.replace('_', ' ')}</span></h1>
          <div className="suave">{ev.local_nome} · {ev.praca} {ev.marca && `· ${ev.marca}`}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {pode('M4', 'criar') && <ClonarEvento id={id} />}
          {pode('M6') && <a className="btn campo" href={`/qr/${id}`} target="_blank" rel="noreferrer">Abrir QR de check-in</a>}
        </div>
      </div>

      {params.get('fotos_falharam') && (
        <div className="aviso" style={{ marginBottom: 12 }}>Evento criado, mas estas fotos não foram enviadas: {params.get('fotos_falharam')}. Envie de novo em “Fotos do local”.</div>
      )}
      <LocalEvento ev={ev} podeEditar={pode('M4', 'editar')} onMudou={carregar} />

      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button className={`btn ${aba === 'escala' ? 'primario' : ''}`} onClick={() => setAba('escala')}>Postos e escala</button>
        {pode('M6') && <button className={`btn ${aba === 'campo' ? 'primario' : ''}`} onClick={() => setAba('campo')}>Presença em campo</button>}
        {pode('M7') && <button className={`btn ${aba === 'fechamento' ? 'primario' : ''}`} onClick={() => setAba('fechamento')}>Fechamento</button>}
      </div>

      {aba === 'escala' && (
        <div className="grade">
          {ev.turnos.map((t: any) => (
            <section className="cartao" key={t.id}>
              <h2>{t.nome} <span className="suave pequeno" style={{ fontWeight: 400 }}>· {fmt.diaSemana(t.inicio)}, {fmt.hora(t.inicio)}–{fmt.hora(t.fim)}</span></h2>
              {t.postos.map((p: any) => (
                <Posto key={p.id} posto={p} alocacoes={escala.filter((a) => a.posto_id === p.id)} fechado={ev.status === 'fechado'}
                       verValores={ev.ver_valores} aoMudar={carregar} />
              ))}
            </section>
          ))}
          {ev.checklist?.length > 0 && (
            <section className="cartao">
              <h2>Checklist de produção</h2>
              {ev.checklist.map((c: any) => (
                <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 400, color: 'var(--texto)', padding: '4px 0' }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={!!c.concluido_em} disabled={!pode('M4', 'editar')}
                         onChange={(e) => api(`/checklist/${c.id}`, { method: 'PATCH', json: { concluido: e.target.checked } }).then(carregar)} />
                  <span style={{ textDecoration: c.concluido_em ? 'line-through' : 'none' }}>{c.descricao}</span>
                  {c.prazo && <span className="suave pequeno">até {fmt.data(c.prazo)}</span>}
                </label>
              ))}
            </section>
          )}
        </div>
      )}
      {aba === 'campo' && <Presenca id={id} />}
      {aba === 'fechamento' && <Fechamento ev={ev} aoMudar={carregar} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
function Posto({ posto, alocacoes, fechado, verValores, aoMudar }: any) {
  const { pode } = usePainel();
  const [sugestoes, setSugestoes] = useState<any[] | null>(null);
  const [msg, setMsg] = useState<{ tipo: string; texto: string } | null>(null);

  const titulares = alocacoes.filter((a: any) => a.tipo === 'titular' && ['convidado', 'confirmado'].includes(a.status));
  const suplentes = alocacoes.filter((a: any) => a.tipo === 'suplente' && ['convidado', 'confirmado'].includes(a.status));
  const outros = alocacoes.filter((a: any) => !['convidado', 'confirmado'].includes(a.status));

  async function buscar() {
    setMsg(null);
    setSugestoes(await api(`/postos/${posto.id}/sugestoes?limite=30`));
  }

  async function alocar(profissional_id: string, tipo: 'titular' | 'suplente') {
    setMsg(null);
    try {
      await api(`/postos/${posto.id}/alocacoes`, { method: 'POST', json: { profissional_id, tipo } });
      setMsg({ tipo: 'ok', texto: tipo === 'titular' ? 'Convite registrado. Envie o link de acesso para a pessoa confirmar.' : 'Adicionado como suplente.' });
      await aoMudar(); await buscar();
    } catch (e: any) {
      setMsg({ tipo: 'erro', texto: e.message + (e.dados?.dica ? ` ${e.dados.dica}` : '') });
    }
  }

  async function mudarStatus(a: any, status: string) {
    const motivo = status === 'cancelado' || status === 'recusado' ? prompt('Motivo (fica no histórico):') ?? undefined : undefined;
    if ((status === 'cancelado' || status === 'recusado') && !motivo) return;
    try { await api(`/alocacoes/${a.id}`, { method: 'PATCH', json: { status, motivo } }); await aoMudar(); }
    catch (e: any) { setMsg({ tipo: 'erro', texto: e.message }); }
  }

  async function promover(a: any) {
    try { await api(`/alocacoes/${a.id}/promover`, { method: 'POST' }); await aoMudar(); }
    catch (e: any) { setMsg({ tipo: 'erro', texto: e.message }); }
  }

  const ocupado = titulares.length;
  return (
    <div style={{ borderTop: '1px solid var(--borda)', padding: '14px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <strong>{posto.funcao}</strong> — {ocupado}/{posto.quantidade}
          {posto.vagas_abertas > 0 ? <span className="etiqueta alerta" style={{ marginLeft: 8 }}>{posto.vagas_abertas} vaga(s)</span>
            : <span className="etiqueta ok" style={{ marginLeft: 8 }}>completo</span>}
          <div className="suave pequeno">
            {verValores && `Paga ${fmt.moeda(posto.diaria_custo)} · cobra ${fmt.moeda(posto.diaria_venda)} · `}
            {posto.uniforme && `Uniforme: ${posto.uniforme} · `}
            {Object.entries(posto.requisitos ?? {}).map(([k, v]) => `${k.replace('_', ' ')}: ${Array.isArray(v) ? v.join('/') : v}`).join(' · ')}
          </div>
        </div>
        {!fechado && pode('M5', 'criar') && (
          sugestoes ? <button className="btn pequeno" onClick={() => setSugestoes(null)}>Fechar sugestões</button>
            : <button className="btn pequeno primario" onClick={buscar}>Encontrar profissionais</button>
        )}
      </div>

      {msg && <div className={`aviso ${msg.tipo}`} style={{ marginTop: 10 }}>{msg.texto}</div>}

      {[...titulares, ...suplentes, ...outros].length > 0 && (
        <table style={{ marginTop: 8 }}>
          <tbody>
            {[...titulares, ...suplentes, ...outros].map((a: any) => (
              <tr key={a.id}>
                <td><Link href={`/profissionais/${a.profissional_id}`}>{a.profissional}</Link>
                  {a.tipo === 'suplente' && <span className="etiqueta neutra" style={{ marginLeft: 6 }}>suplente</span>}
                  <div className="suave pequeno">{a.celular}</div></td>
                <td><span className={`etiqueta ${COR_ALOCACAO[a.status]}`}>{a.status}</span>
                  {a.respondido_em && <div className="suave pequeno">resp. {fmt.dataHora(a.respondido_em)}</div>}
                  {a.motivo && <div className="suave pequeno">{a.motivo}</div>}</td>
                <td className="pequeno">{a.checkin_em ? `entrou ${fmt.hora(a.checkin_em)}${a.atraso_min > 0 ? ` (+${a.atraso_min} min)` : ''}` : ''}
                  {a.checkout_em && ` · saiu ${fmt.hora(a.checkout_em)}`}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {!fechado && pode('M5', 'editar') && a.status === 'convidado' &&
                    <button className="btn pequeno" onClick={() => mudarStatus(a, 'confirmado')}>Confirmar</button>}
                  {!fechado && pode('M5', 'editar') && a.tipo === 'suplente' && ['convidado', 'confirmado'].includes(a.status) && posto.vagas_abertas > 0 &&
                    <button className="btn pequeno" onClick={() => promover(a)}>Promover</button>}
                  {!fechado && pode('M5', 'editar') && ['convidado', 'confirmado'].includes(a.status) &&
                    <button className="btn pequeno perigo" onClick={() => mudarStatus(a, 'cancelado')}>Cancelar</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {sugestoes && (
        <div className="cartao" style={{ marginTop: 10, background: 'var(--bg)' }}>
          <h3>Melhores candidatos para este posto</h3>
          <p className="suave pequeno" style={{ marginTop: 0 }}>
            Já excluídos: quem tem conflito de horário, indisponibilidade, está bloqueado ou não atende aos requisitos.
          </p>
          {sugestoes.length === 0 && <p className="suave">Ninguém disponível com esse perfil.</p>}
          <table>
            <tbody>
              {sugestoes.map((s) => (
                <tr key={s.profissional_id}>
                  <td style={{ width: 54 }}><div className="pontuacao" style={{ fontSize: '1.2rem', color: s.pontuacao >= 60 ? 'var(--ok)' : s.pontuacao >= 40 ? 'var(--alerta)' : 'var(--suave)' }}>{s.pontuacao}</div></td>
                  <td><Link href={`/profissionais/${s.profissional_id}`} target="_blank"><strong>{s.nome}</strong></Link>
                    <span className="suave pequeno"> · {s.cidade}{s.nota_media && ` · ★ ${s.nota_media}`}{s.assiduidade_pct && ` · ${fmt.pct(s.assiduidade_pct)} presença`}</span>
                    <div className="pequeno" style={{ color: 'var(--ok)' }}>{s.motivos.join(' · ')}</div>
                    {s.alertas.length > 0 && <div className="pequeno" style={{ color: 'var(--alerta)' }}>⚠ {s.alertas.join(' · ')}</div>}
                  </td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {posto.vagas_abertas > 0 && <button className="btn pequeno primario" onClick={() => alocar(s.profissional_id, 'titular')}>Convidar</button>}{' '}
                    <button className="btn pequeno" onClick={() => alocar(s.profissional_id, 'suplente')}>Suplente</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
function ClonarEvento({ id }: { id: string }) {
  async function clonar() {
    const data = prompt('Data e hora de início do novo evento (AAAA-MM-DD HH:MM):');
    if (!data) return;
    const r = await api(`/eventos/${id}/clonar`, { method: 'POST', json: { novo_inicio: new Date(data.replace(' ', 'T')).toISOString() } });
    window.location.href = `/eventos/${r.id}`;
  }
  return <button className="btn" onClick={clonar}>Clonar como novo</button>;
}

/* ------------------------------------------------------------------ */
function Presenca({ id }: { id: string }) {
  const { pode } = usePainel();
  const [dados, setDados] = useState<any>(null);
  const carregar = useCallback(() => api(`/eventos/${id}/presenca`).then(setDados), [id]);
  useEffect(() => { carregar(); const t = setInterval(carregar, 20_000); return () => clearInterval(t); }, [carregar]);

  async function manual(a: any, tipo: string) {
    const observacao = prompt(`Motivo do lançamento manual (${tipo}):`);
    if (!observacao) return;
    try { await api(`/alocacoes/${a.alocacao_id}/ponto-manual`, { method: 'POST', json: { tipo, observacao } }); carregar(); }
    catch (e: any) { alert(e.message); }
  }

  if (!dados) return <div className="suave">Carregando…</div>;
  const COR: Record<string, string> = { presente: 'ok', saiu: 'neutra', atrasado: 'erro', aguardando: 'alerta', falta: 'erro', falta_justificada: 'neutra' };
  return (
    <section className="cartao">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(dados.resumo).map(([k, v]) => <span key={k} className={`etiqueta ${COR[k]}`}>{k}: {String(v)}</span>)}
        <span className="suave pequeno">atualiza a cada 20 s</span>
      </div>
      <div className="tabela"><table>
        <thead><tr><th>Profissional</th><th>Turno</th><th>Situação</th><th>Entrada</th><th>Saída</th><th></th></tr></thead>
        <tbody>
          {dados.linhas.map((l: any) => (
            <tr key={l.alocacao_id}>
              <td>{l.nome}<div className="suave pequeno">{l.funcao} · {l.celular}</div></td>
              <td className="pequeno">{l.turno}<div className="suave">{fmt.hora(l.inicio)}–{fmt.hora(l.fim)}</div></td>
              <td><span className={`etiqueta ${COR[l.situacao]}`}>{l.situacao}</span>{l.suspeito && <span className="etiqueta erro" style={{ marginLeft: 4 }} title={l.observacao}>verificar</span>}</td>
              <td className="pequeno">{fmt.hora(l.checkin_em)}{l.atraso_min > 0 && <div className="suave">+{l.atraso_min} min</div>}</td>
              <td className="pequeno">{fmt.hora(l.checkout_em)}</td>
              <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>{pode('M6', 'editar') && (<>
                {!l.checkin_em && <button className="btn pequeno" onClick={() => manual(l, 'checkin')}>Entrada manual</button>}
                {l.checkin_em && !l.checkout_em && <button className="btn pequeno" onClick={() => manual(l, 'checkout')}>Saída manual</button>}
                {!l.checkin_em && <button className="btn pequeno perigo" onClick={() => manual(l, 'falta')}>Falta</button>}
              </>)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
function Fechamento({ ev, aoMudar }: { ev: any; aoMudar: () => void }) {
  const { pode } = usePainel();
  const [pend, setPend] = useState<any[]>([]);
  const [res, setRes] = useState<any>(null);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    setPend(await api(`/eventos/${ev.id}/pendencias`));
    if (ev.status === 'fechado') setRes(await api(`/eventos/${ev.id}/fechamento`));
  }, [ev.id, ev.status]);
  useEffect(() => { carregar(); }, [carregar]);

  async function justificar(posto_id: string) {
    const j = prompt('Justificativa para fechar com a vaga em aberto:');
    if (!j) return;
    await api(`/postos/${posto_id}`, { method: 'PATCH', json: { justificativa_vaga_aberta: j } });
    carregar();
  }

  async function fechar() {
    setErro('');
    const soCheckout = pend.every((p) => p.tipo === 'checkout_pendente');
    if (pend.length && !soCheckout) return;
    if (!confirm('Fechar o evento? A escala fica travada e os valores a pagar são gerados.')) return;
    try {
      await api(`/eventos/${ev.id}/fechar`, { method: 'POST', json: { aceitar_checkout_pendente: soCheckout } });
      aoMudar();
    } catch (e: any) { setErro(e.message); }
  }

  if (ev.status === 'fechado' && res) {
    return (
      <div className="grade">
        {res.margem && (
          <div className="grade g4">
            <div className="cartao kpi"><div className="rotulo">Receita</div><div className="valor">{fmt.moeda(res.margem.receita)}</div></div>
            <div className="cartao kpi"><div className="rotulo">Custo de equipe</div><div className="valor">{fmt.moeda(res.margem.custo_equipe)}</div></div>
            <div className="cartao kpi"><div className="rotulo">Custos diretos</div><div className="valor">{fmt.moeda(res.margem.custos_diretos)}</div></div>
            <div className="cartao kpi"><div className="rotulo">Margem</div>
              <div className="valor">{fmt.moeda(res.margem.receita - res.margem.custo_equipe - res.margem.custos_diretos)}</div></div>
          </div>
        )}
        <section className="cartao">
          <h2>Valores a pagar</h2>
          <table>
            <thead><tr><th>Profissional</th><th>Presença</th><th>Horas</th><th>Diária</th><th>Extra</th><th>Noturno</th><th>Desc./Adic.</th><th>Total</th></tr></thead>
            <tbody>
              {res.custos.map((c: any) => (
                <tr key={c.alocacao_id}><td>{c.profissional}</td><td>{c.presenca}</td><td>{c.horas_trabalhadas}</td>
                  <td>{fmt.moeda(c.valor_diaria)}</td><td>{fmt.moeda(c.valor_extra)}</td><td>{fmt.moeda(c.valor_noturno)}</td>
                  <td>{fmt.moeda(Number(c.valor_descontos) + Number(c.valor_adicionais))}</td><td><strong>{fmt.moeda(c.valor_total)}</strong></td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    );
  }

  return (
    <section className="cartao">
      <h2>Pendências para fechar</h2>
      {pend.length === 0 ? <div className="aviso ok">Nenhuma pendência. O evento pode ser fechado.</div> : (
        <table><tbody>
          {pend.map((p, i) => (
            <tr key={i}><td><span className="etiqueta alerta">{p.tipo.replaceAll('_', ' ')}</span></td><td>{p.descricao}</td>
              <td>{p.tipo === 'vaga_aberta' && pode('M4', 'editar') && <button className="btn pequeno" onClick={() => justificar(p.referencia)}>Justificar</button>}</td></tr>
          ))}
        </tbody></table>
      )}
      {erro && <div className="aviso erro" style={{ marginTop: 10 }}>{erro}</div>}
      {pode('M7', 'aprovar') && ['confirmado', 'em_execucao', 'encerrado'].includes(ev.status) && (
        <div style={{ marginTop: 14 }}>
          <button className="btn primario" disabled={pend.some((p) => p.tipo !== 'checkout_pendente')} onClick={fechar}>
            Fechar evento e gerar pagamentos
          </button>
          {pend.some((p) => p.tipo === 'checkout_pendente') && pend.every((p) => p.tipo === 'checkout_pendente') &&
            <p className="suave pequeno">Quem ficou sem check-out será calculado até o fim do turno.</p>}
        </div>
      )}
    </section>
  );
}
