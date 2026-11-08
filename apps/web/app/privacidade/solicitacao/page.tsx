'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiPublica, ErroApi, fmt } from '@/lib/api';
import { PaginaLegal } from '@/components/legal/PaginaLegal';

/**
 * Direitos do titular (LGPD, art. 18): o pedido vai para a empresa escolhida (a controladora dos dados),
 * que responde em até 15 dias. Vem preenchida a partir do link de Casting ou da área do profissional (?empresa=).
 */
const TIPOS: [string, string, string][] = [
  ['confirmacao_acesso', 'Saber se vocês têm meus dados e ver quais são', 'Confirmação e acesso'],
  ['correcao', 'Corrigir dados errados ou desatualizados', 'Correção'],
  ['exclusao', 'Excluir meus dados', 'Exclusão'],
  ['portabilidade', 'Receber uma cópia dos meus dados em arquivo', 'Portabilidade'],
  ['revogacao_consentimento', 'Retirar o consentimento que dei (por exemplo, no Casting)', 'Revogação do consentimento'],
  ['informacao_compartilhamento', 'Saber com quem meus dados são compartilhados', 'Compartilhamento'],
  ['oposicao', 'Me opor a um uso dos meus dados', 'Oposição'],
];
const RELACOES: [string, string][] = [['profissional', 'Trabalho ou trabalhei em eventos'], ['candidato_casting', 'Me inscrevi no Casting'],
  ['contato_cliente', 'Sou contato de um cliente'], ['usuario', 'Sou usuário do sistema'], ['outro', 'Outro']];

export default function Solicitacao() {
  const [codigo, setCodigo] = useState('');
  const [empresa, setEmpresa] = useState<{ nome: string } | null>(null);
  const [erroEmpresa, setErroEmpresa] = useState('');
  const [f, setF] = useState<Record<string, string>>({ tipo: '', relacao: '' });
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [protocolo, setProtocolo] = useState<{ protocolo: string; prazo_em: string } | null>(null);

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('empresa') ?? '';
    if (c) { setCodigo(c); buscar(c); }
  }, []);

  async function buscar(c = codigo) {
    setErroEmpresa(''); setEmpresa(null);
    if (!c.trim()) return;
    try { setEmpresa((await apiPublica(`/titulares/${encodeURIComponent(c.trim().toLowerCase())}`)).empresa); }
    catch (e) { setErroEmpresa((e as ErroApi).message); }
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    if (!empresa) { setErro('Informe e confirme a empresa.'); return; }
    setEnviando(true);
    try {
      setProtocolo(await apiPublica(`/titulares/${encodeURIComponent(codigo.trim().toLowerCase())}`, f));
      window.scrollTo({ top: 0 });
    } catch (er) { setErro((er as ErroApi).message); } finally { setEnviando(false); }
  }
  const muda = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  return (
    <PaginaLegal titulo="Seus direitos sobre os seus dados"
      resumo={<>Pela LGPD você pode pedir acesso, correção, exclusão ou cópia dos seus dados, e retirar um consentimento.
        O pedido vai para a empresa de eventos com quem você tem relação, que responde em até 15 dias.
        Saiba mais na <Link href="/privacidade">Política de Privacidade</Link>.</>}>
      {protocolo ? (
        <div className="cartao" style={{ textAlign: 'center' }}>
          <h2>Pedido registrado</h2>
          <p>Seu protocolo é <b style={{ fontSize: '1.3rem', letterSpacing: '.08em' }}>{protocolo.protocolo}</b>.</p>
          <p className="suave">A {empresa?.nome} vai responder pelo contato informado até {fmt.data(protocolo.prazo_em)}. Guarde o protocolo.</p>
        </div>
      ) : (
        <form className="form cartao" onSubmit={enviar} noValidate>
          {erro && <div className="aviso erro" role="alert">{erro}</div>}
          <label>Código da empresa *
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={codigo} onChange={(e) => { setCodigo(e.target.value); setEmpresa(null); }} onBlur={() => buscar()} placeholder="ex.: rafadutra" />
              <button type="button" className="btn" onClick={() => buscar()}>Confirmar</button>
            </div>
            {empresa && <small style={{ color: 'var(--ok)' }}>Empresa: {empresa.nome}</small>}
            {erroEmpresa && <small style={{ color: 'var(--erro)' }}>{erroEmpresa}</small>}
            <small className="suave">É o mesmo código que aparece no link de Casting ou no login da empresa. Não sabe? Pergunte para quem te contatou.</small>
          </label>
          <label>O que você quer pedir? *<select value={f.tipo} onChange={muda('tipo')} required>
            <option value="">Escolha</option>{TIPOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select></label>
          <label>Qual é a sua relação com a empresa? *<select value={f.relacao} onChange={muda('relacao')} required>
            <option value="">Escolha</option>{RELACOES.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
          </select></label>
          <label>Nome completo *<input value={f.nome ?? ''} onChange={muda('nome')} autoComplete="name" maxLength={120} /></label>
          <div className="linha">
            <label>Celular<input value={f.celular ?? ''} onChange={muda('celular')} inputMode="tel" placeholder="(43) 99999-0000" /></label>
            <label>E-mail<input type="email" value={f.email ?? ''} onChange={muda('email')} /></label>
          </div>
          <small className="suave">Informe pelo menos um dos dois: é por onde a resposta vai chegar. Use o mesmo contato que a empresa tem de você.</small>
          <label>Detalhes<textarea rows={4} value={f.descricao ?? ''} onChange={muda('descricao')} maxLength={2000}
                 placeholder="Ex.: quero corrigir meu celular, que mudou para (43) 98888-0000." /></label>
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="casting-isca" value={f.site ?? ''} onChange={muda('site')} />
          <p className="suave pequeno" style={{ margin: 0 }}>Para proteger você, a empresa pode pedir a confirmação da sua identidade antes de atender.
            Os dados deste formulário são usados só para responder ao pedido.</p>
          <button className="btn primario grande" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviar pedido'}</button>
        </form>
      )}
    </PaginaLegal>
  );
}
