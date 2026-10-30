'use client';
import { useEffect, useState } from 'react';
import { api, fmt } from '@/lib/api';
import { usePainel } from '@/components/Painel';
import { Confirmar } from '@/components/Confirmar';

const PERFIS: Record<string, string> = { admin: 'Administradora', central: 'Central', supervisor: 'Supervisor', financeiro: 'Financeiro' };

/** Código de login gerado a partir do nome: "RFK Promoções" → "rfk-promocoes" */
const paraCodigo = (nome: string) =>
  nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const mensagemErro = (e: any, duplicado: string) =>
  e.codigo === 'duplicado' ? duplicado : e.dados?.campos?.[0]?.mensagem ?? e.message;

/** Cadastro de empresas da plataforma: só o usuário master vê esta tela */
export default function Empresas() {
  const { me } = usePainel();
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [modulos, setModulos] = useState<any[]>([]);
  const [nova, setNova] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<any>(null);
  const [msg, setMsg] = useState('');

  const carregar = () => api('/empresas').then(setEmpresas);
  useEffect(() => {
    if (!me.usuario.master) return;
    carregar();
    api('/admin/modulos').then(setModulos);
  }, [me.usuario.master]);

  if (!me.usuario.master) return <div className="cartao">Somente o usuário master acessa o cadastro de empresas.</div>;

  const nomeModulo = (c: string) => modulos.find((m) => m.codigo === c)?.nome ?? c;

  return (
    <>
      <div className="topo">
        <div><h1>Empresas</h1>
          <div className="suave">Cada empresa só enxerga os próprios dados. Usuários entram com o código da empresa, o e-mail e a senha.</div></div>
        {!nova && <button className="btn primario" onClick={() => { setNova(true); setMsg(''); }}>Nova empresa</button>}
      </div>
      {msg && <div className="aviso ok" style={{ marginBottom: 12 }}>{msg}</div>}

      {nova && <NovaEmpresa modulos={modulos} onCancelar={() => setNova(false)}
        onCriada={(e) => { setNova(false); setMsg(`Empresa ${e.nome} criada. Código de acesso: ${e.slug}`); carregar(); setAberta(e.id); }} />}

      <section className="cartao">
        <div className="tabela"><table>
          <thead><tr><th>Empresa</th><th>Código de acesso</th><th>Situação</th><th>Usuários ativos</th><th>Módulos</th><th></th></tr></thead>
          <tbody>
            {empresas.map((e) => (
              <FragmentoEmpresa key={e.id} e={e} aberta={aberta === e.id} nomeModulo={nomeModulo}
                propria={e.slug === me.empresa.slug}
                onAbrir={() => setAberta(aberta === e.id ? null : e.id)}
                onSituacao={() => setConfirmar(e)} onMudou={carregar} />
            ))}
          </tbody>
        </table></div>
      </section>

      {confirmar && (
        <Confirmar titulo={confirmar.ativo ? 'Inativar empresa?' : 'Reativar empresa?'} rotulo={confirmar.ativo ? 'Sim, inativar' : 'Sim, reativar'}
          perigo={confirmar.ativo} onCancelar={() => setConfirmar(null)}
          onConfirmar={async () => {
            await api(`/empresas/${confirmar.id}`, { method: 'PUT', json: { ativo: !confirmar.ativo } });
            setMsg(`${confirmar.nome} ${confirmar.ativo ? 'inativada' : 'reativada'}.`);
            setConfirmar(null); carregar();
          }}>
          {confirmar.ativo
            ? <p>Os usuários de <strong>{confirmar.nome}</strong> deixam de conseguir entrar no sistema. Os dados ficam guardados e voltam ao reativar.</p>
            : <p>Os usuários ativos de <strong>{confirmar.nome}</strong> voltam a conseguir entrar.</p>}
        </Confirmar>
      )}
    </>
  );
}

function FragmentoEmpresa({ e, aberta, propria, nomeModulo, onAbrir, onSituacao, onMudou }: {
  e: any; aberta: boolean; propria: boolean; nomeModulo: (c: string) => string;
  onAbrir: () => void; onSituacao: () => void; onMudou: () => void;
}) {
  return (
    <>
      <tr>
        <td><strong>{e.nome}</strong><div className="suave pequeno">desde {fmt.data(e.criado_em)}</div></td>
        <td><code>{e.slug}</code></td>
        <td>{e.ativo ? <span className="etiqueta ok">ativa</span> : <span className="etiqueta neutra">inativa</span>}</td>
        <td>{e.usuarios}</td>
        <td className="pequeno" title={e.modulos.map(nomeModulo).join(', ')}>{e.modulos.join(', ') || '—'}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="btn pequeno" onClick={onAbrir}>{aberta ? 'Fechar' : 'Usuários'}</button>{' '}
          {!propria && <button className={`btn pequeno ${e.ativo ? 'perigo' : ''}`} onClick={onSituacao}>{e.ativo ? 'Inativar' : 'Reativar'}</button>}
        </td>
      </tr>
      {aberta && <tr><td colSpan={6} style={{ background: 'var(--bg)' }}><UsuariosEmpresa empresa={e} onMudou={onMudou} /></td></tr>}
    </>
  );
}

function NovaEmpresa({ modulos, onCancelar, onCriada }: { modulos: any[]; onCancelar: () => void; onCriada: (e: any) => void }) {
  const [nome, setNome] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [escolhidos, setEscolhidos] = useState<string[]>(['M1', 'M3', 'M4', 'M5', 'M7', 'BI']);
  const [admin, setAdmin] = useState({ nome: '', email: '', senha: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(''); setSalvando(true);
    try {
      onCriada(await api('/empresas', { method: 'POST', json: { nome, slug, modulos: escolhidos, admin } }));
    } catch (e: any) {
      setErro(mensagemErro(e, 'Já existe uma empresa com esse código de acesso.'));
    } finally { setSalvando(false); }
  }

  const alternar = (c: string) => setEscolhidos((l) => l.includes(c) ? l.filter((x) => x !== c) : [...l, c]);

  return (
    <form className="cartao form" style={{ marginBottom: 16 }} onSubmit={salvar}>
      <h2>Nova empresa</h2>
      <div className="linha">
        <label>Nome da empresa
          <input required value={nome} onChange={(e) => { setNome(e.target.value); if (!slugManual) setSlug(paraCodigo(e.target.value)); }} /></label>
        <label>Código de acesso (usado no login)
          <input required value={slug} pattern="[a-z0-9][a-z0-9\-]{1,39}" title="Letras minúsculas, números ou hífen"
                 onChange={(e) => { setSlugManual(true); setSlug(e.target.value.toLowerCase()); }} /></label>
      </div>

      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Módulos liberados</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
          {modulos.map((m) => (
            <label key={m.codigo} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={escolhidos.includes(m.codigo)} onChange={() => alternar(m.codigo)} />
              {m.codigo} — {m.nome}
            </label>
          ))}
        </div>
        <div className="suave pequeno" style={{ marginTop: 4 }}>A administradora da empresa poderá ajustar depois em Módulos e acessos.</div>
      </div>

      <div style={{ fontWeight: 600 }}>Administradora da empresa (primeiro acesso)</div>
      <div className="linha">
        <label>Nome<input required value={admin.nome} onChange={(e) => setAdmin({ ...admin, nome: e.target.value })} /></label>
        <label>E-mail<input required type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></label>
        <label>Senha inicial<input required type="password" minLength={8} autoComplete="new-password" value={admin.senha}
                                    onChange={(e) => setAdmin({ ...admin, senha: e.target.value })} /></label>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primario" disabled={salvando}>{salvando ? 'Criando…' : 'Criar empresa'}</button>
        <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}

function UsuariosEmpresa({ empresa, onMudou }: { empresa: any; onMudou: () => void }) {
  const [usuarios, setUsuarios] = useState<any[] | null>(null);
  const [novo, setNovo] = useState({ nome: '', email: '', perfil: 'central', senha: '' });
  const [senhaDe, setSenhaDe] = useState<string | null>(null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');

  const carregar = () => api(`/empresas/${empresa.id}/usuarios`).then(setUsuarios);
  useEffect(() => { carregar(); }, [empresa.id]);

  /** Executa e devolve se deu certo (para só limpar o formulário quando salvou) */
  async function executar(acao: () => Promise<unknown>, ok: string, duplicado = '') {
    setErro(''); setMsg('');
    try { await acao(); setMsg(ok); await carregar(); onMudou(); return true; }
    catch (e: any) { setErro(mensagemErro(e, duplicado)); return false; }
  }

  const editar = (u: any, json: any, ok: string) =>
    executar(() => api(`/empresas/${empresa.id}/usuarios/${u.id}`, { method: 'PUT', json }), ok);

  return (
    <div style={{ padding: '8px 4px' }}>
      <h3 style={{ marginTop: 0 }}>Usuários de {empresa.nome}</h3>
      {msg && <div className="aviso ok" style={{ marginBottom: 8 }}>{msg}</div>}
      {erro && <div className="aviso erro" style={{ marginBottom: 8 }}>{erro}</div>}
      {!usuarios ? <div className="suave">Carregando…</div> : (
        <table>
          <thead><tr><th>Nome</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id} style={{ opacity: u.ativo ? 1 : 0.55 }}>
                <td>{u.nome}<div className="suave pequeno">{u.email}</div></td>
                <td>
                  <select value={u.perfil} onChange={(e) => editar(u, { perfil: e.target.value }, `Perfil de ${u.nome} alterado.`)}>
                    {Object.entries(PERFIS).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                  </select>
                </td>
                <td>{u.ativo ? <span className="etiqueta ok">ativo</span> : <span className="etiqueta neutra">inativo</span>}</td>
                <td className="pequeno">{fmt.dataHora(u.ultimo_acesso)}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {senhaDe === u.id ? (
                    <form style={{ display: 'inline-flex', gap: 6 }} onSubmit={(ev) => {
                      ev.preventDefault();
                      editar(u, { senha }, `Senha de ${u.nome} redefinida.`).then((ok) => { if (ok) { setSenhaDe(null); setSenha(''); } });
                    }}>
                      <input type="password" required minLength={8} autoComplete="new-password" placeholder="Nova senha"
                             value={senha} onChange={(e) => setSenha(e.target.value)} style={{ width: 140 }} />
                      <button className="btn pequeno primario">Salvar</button>
                      <button type="button" className="btn pequeno" onClick={() => { setSenhaDe(null); setSenha(''); }}>×</button>
                    </form>
                  ) : (
                    <>
                      <button className="btn pequeno" onClick={() => { setSenhaDe(u.id); setSenha(''); }}>Redefinir senha</button>{' '}
                      <button className={`btn pequeno ${u.ativo ? 'perigo' : ''}`}
                              onClick={() => editar(u, { ativo: !u.ativo }, `${u.nome} ${u.ativo ? 'inativado' : 'reativado'}.`)}>
                        {u.ativo ? 'Inativar' : 'Reativar'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="form" style={{ marginTop: 12 }} onSubmit={(ev) => {
        ev.preventDefault();
        executar(() => api(`/empresas/${empresa.id}/usuarios`, { method: 'POST', json: novo }),
          `${novo.nome} cadastrado.`, 'Já existe um usuário com esse e-mail nesta empresa.')
          .then((ok) => ok && setNovo((n) => ({ ...n, nome: '', email: '', senha: '' })));
      }}>
        <div style={{ fontWeight: 600 }}>Novo usuário</div>
        <div className="linha">
          <label>Nome<input required value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} /></label>
          <label>E-mail<input required type="email" value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} /></label>
          <label>Perfil
            <select value={novo.perfil} onChange={(e) => setNovo({ ...novo, perfil: e.target.value })}>
              {Object.entries(PERFIS).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select></label>
          <label>Senha inicial<input required type="password" minLength={8} autoComplete="new-password" value={novo.senha}
                                      onChange={(e) => setNovo({ ...novo, senha: e.target.value })} /></label>
        </div>
        <div><button className="btn primario">Cadastrar usuário</button></div>
      </form>
    </div>
  );
}
