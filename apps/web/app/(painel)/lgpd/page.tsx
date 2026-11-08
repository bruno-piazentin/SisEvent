'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { usePainel } from '@/components/Painel';
import { Confirmar } from '@/components/Confirmar';

/** Privacidade (LGPD): pedidos dos titulares, exportação dos dados e exclusão por anonimização. Só a administradora. */
const TIPOS: Record<string, string> = {
  confirmacao_acesso: 'Confirmação e acesso', correcao: 'Correção', exclusao: 'Exclusão', portabilidade: 'Portabilidade',
  revogacao_consentimento: 'Revogação do consentimento', informacao_compartilhamento: 'Compartilhamento', oposicao: 'Oposição',
};
const RELACOES: Record<string, string> = { profissional: 'Profissional', candidato_casting: 'Candidato de Casting', contato_cliente: 'Contato de cliente', usuario: 'Usuário', outro: 'Outro' };
const STATUS: Record<string, [string, string]> = { aberta: ['Aberta', 'alerta'], em_andamento: ['Em andamento', ''], concluida: ['Concluída', 'ok'], recusada: ['Recusada', 'erro'] };

export default function Lgpd() {
  const { me, pode } = usePainel();
  if (me.usuario.perfil !== 'admin') {
    return <div className="cartao"><h2>Somente a administradora</h2><p className="suave">Os pedidos de LGPD são atendidos pela administradora da empresa.</p></div>;
  }
  return (
    <>
      <div className="topo"><div><h1>Privacidade (LGPD)</h1>
        <p className="suave" style={{ margin: 0 }}>Pedidos dos titulares e ferramentas para atendê-los. Prazo de resposta: 15 dias.</p></div></div>
      <LinkPedidos slug={me.empresa.slug} />
      <Pedidos />
      <Ferramentas podeDp={pode('DP', 'ver') || !!me.usuario.master} />
    </>
  );
}

function LinkPedidos({ slug }: { slug: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => { setUrl(`${window.location.origin}/privacidade/solicitacao?empresa=${slug}`); }, [slug]);
  return (
    <div className="cartao" style={{ marginBottom: 16 }}>
      <h2>Onde os titulares fazem os pedidos</h2>
      <p className="suave pequeno" style={{ marginTop: 0 }}>Este link já vem com a empresa preenchida. Ele também aparece na Política de Privacidade e no formulário de Casting.</p>
      <code style={{ wordBreak: 'break-all' }}>{url}</code>
      <p className="pequeno" style={{ marginBottom: 0 }}><Link href="/privacidade" target="_blank">Política de Privacidade</Link> · <Link href="/termos" target="_blank">Termos de Uso</Link> · <Link href="/cookies" target="_blank">Política de Cookies</Link></p>
    </div>
  );
}

function Pedidos() {
  const [status, setStatus] = useState('todas');
  const [lista, setLista] = useState<any[] | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const carregar = useCallback(() => { api(`/privacidade/solicitacoes?status=${status}`).then(setLista); }, [status]);
  useEffect(carregar, [carregar]);

  return (
    <div className="cartao" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Pedidos dos titulares</h2>
        <select style={{ width: 'auto' }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="todas">Todos</option><option value="aberta">Abertos</option><option value="em_andamento">Em andamento</option>
          <option value="concluida">Concluídos</option><option value="recusada">Recusados</option>
        </select>
      </div>
      {!lista ? <p className="suave">Carregando…</p> : lista.length === 0 ? <p className="suave">Nenhum pedido.</p> : (
        <div className="grade" style={{ marginTop: 12 }}>
          {lista.map((s) => (
            <div key={s.id} style={{ border: '1px solid var(--borda)', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <strong>{TIPOS[s.tipo]}</strong> · {s.nome} <span className="suave pequeno">({RELACOES[s.relacao]})</span>
                  <div className="suave pequeno">Protocolo {s.protocolo} · recebido em {fmt.data(s.criada_em)} · prazo {fmt.data(s.prazo_em)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  {s.atrasada && <span className="etiqueta erro">Prazo vencido</span>}
                  <span className={`etiqueta ${STATUS[s.status][1]}`}>{STATUS[s.status][0]}</span>
                </div>
              </div>
              <div className="pequeno" style={{ marginTop: 6 }}>{[s.celular, s.email].filter(Boolean).join(' · ')}</div>
              {s.descricao && <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{s.descricao}</p>}
              {s.resposta && <p className="pequeno" style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}><b>Resposta{s.respondida_por_nome ? ` (${s.respondida_por_nome}, ${fmt.data(s.respondida_em)})` : ''}:</b> {s.resposta}</p>}
              {aberto === s.id ? <Responder s={s} onFim={() => { setAberto(null); carregar(); }} />
                : <button className="btn pequeno" style={{ marginTop: 8 }} onClick={() => setAberto(s.id)}>Atualizar</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Responder({ s, onFim }: { s: any; onFim: () => void }) {
  const [status, setStatus] = useState(s.status === 'aberta' ? 'em_andamento' : s.status);
  const [resposta, setResposta] = useState(s.resposta ?? '');
  const [erro, setErro] = useState('');
  async function salvar() {
    setErro('');
    try { await api(`/privacidade/solicitacoes/${s.id}`, { method: 'PATCH', json: { status, resposta } }); onFim(); }
    catch (e: any) { setErro(e.message); }
  }
  return (
    <div className="form" style={{ marginTop: 10 }}>
      <p className="suave pequeno" style={{ margin: 0 }}>Antes de atender, confirme que quem pediu é o titular (por exemplo, respondendo pelo mesmo celular ou e-mail que a empresa tem cadastrado).</p>
      <label>Situação<select value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="em_andamento">Em andamento</option><option value="concluida">Concluída</option><option value="recusada">Recusada (explique o motivo)</option>
      </select></label>
      <label>Resposta dada ao titular<textarea rows={3} value={resposta} onChange={(e) => setResposta(e.target.value)} maxLength={4000}
             placeholder="Ex.: dados corrigidos em 10/11; enviamos a cópia por e-mail; cadastro anonimizado." /></label>
      {erro && <div className="aviso erro">{erro}</div>}
      <div style={{ display: 'flex', gap: 8 }}><button className="btn primario" onClick={salvar}>Salvar</button><button className="btn" onClick={onFim}>Cancelar</button></div>
    </div>
  );
}

function Ferramentas({ podeDp }: { podeDp: boolean }) {
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<any[]>([]);
  const [alvo, setAlvo] = useState<any>(null);
  const [confirmacao, setConfirmacao] = useState('');
  const [aviso, setAviso] = useState('');

  useEffect(() => {
    if (busca.trim().length < 3) { setAchados([]); return; }
    const t = setTimeout(() => api(`/profissionais?q=${encodeURIComponent(busca.trim())}`).then((r) => setAchados(r.slice(0, 8))).catch(() => setAchados([])), 300);
    return () => clearTimeout(t);
  }, [busca]);

  async function exportar(p: any) {
    const dados = await api(`/privacidade/profissionais/${p.id}/exportar`);
    const url = URL.createObjectURL(new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `dados-${p.nome.toLowerCase().replace(/\s+/g, '-')}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  if (!podeDp) return <div className="cartao"><h2>Exportar e excluir dados</h2><p className="suave">É preciso a permissão "Dados pessoais" (DP) para exportar ou anonimizar cadastros.</p></div>;
  return (
    <div className="cartao">
      <h2>Exportar e excluir dados de um profissional</h2>
      <p className="suave pequeno" style={{ marginTop: 0 }}>
        <b>Exportar</b> gera um arquivo com todos os dados do cadastro (atende acesso e portabilidade).
        <b> Excluir</b> anonimiza: apaga fotos, documentos, contatos e características, limpa o histórico de alterações e bloqueia o cadastro.
        Escalas e pagamentos continuam registrados sem identificar a pessoa. Inscrições de Casting são excluídas na tela de Captação.
      </p>
      <input placeholder="Buscar profissional pelo nome (3 letras ou mais)" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {aviso && <div className="aviso ok" style={{ marginTop: 10 }}>{aviso}</div>}
      {achados.length > 0 && (
        <div className="grade" style={{ marginTop: 10, gap: 8 }}>
          {achados.map((p) => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--borda)', paddingBottom: 8 }}>
              <span><b>{p.nome}</b> <span className="suave pequeno">{[p.cidade, p.status].filter(Boolean).join(' · ')}</span></span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn pequeno" onClick={() => exportar(p)}>Exportar dados</button>
                <button className="btn pequeno perigo" onClick={() => { setConfirmacao(''); setAlvo(p); }}>Excluir (anonimizar)</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {alvo && (
        <Confirmar titulo={`Excluir os dados de ${alvo.nome}`} rotulo="Anonimizar" perigo onCancelar={() => setAlvo(null)}
          onConfirmar={async () => {
            await api(`/privacidade/profissionais/${alvo.id}/anonimizar`, { method: 'POST', json: { confirmacao } });
            setAlvo(null); setBusca(''); setAviso(`Dados de ${alvo.nome} anonimizados. Registre a resposta no pedido do titular.`);
          }}>
          <p>Não dá para desfazer. O cadastro vira “Titular removido”, bloqueado para escalas. Se houver pagamentos pendentes ou escalas futuras, resolva-os antes.</p>
          <label>Digite EXCLUIR para confirmar<input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} /></label>
        </Confirmar>
      )}
    </div>
  );
}
