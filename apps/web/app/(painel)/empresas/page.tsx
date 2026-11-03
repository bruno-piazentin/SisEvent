'use client';
import { useEffect, useState } from 'react';
import { api, fmt } from '@/lib/api';
import { usePainel } from '@/components/Painel';
import { Confirmar } from '@/components/Confirmar';
import { CamposContato, CamposEndereco, CamposIdentificacao, CamposRedes, corpoCadastro } from '@/components/CamposCadastro';
import { LogoEmpresa } from '@/components/Marca';
import { prepararLogo } from '@/lib/imagem';
import { mascara } from '@/lib/ui';
import { ConfigPrazos } from '@/components/PrazoEventos';
import { PRAZOS_PADRAO } from '@/lib/prazos';

const PERFIS: Record<string, string> = { admin: 'Administradora', central: 'Central', supervisor: 'Supervisor', financeiro: 'Financeiro' };

/** Código de login gerado a partir do nome: "RFK Promoções" → "rfk-promocoes" */
const paraCodigo = (nome: string) =>
  nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const mensagemErro = (e: any, duplicado: string) =>
  e.codigo === 'duplicado' ? duplicado : e.dados?.campos?.[0]?.mensagem ?? e.message;

/** Cadastro de empresas da plataforma: só o usuário master vê esta tela */
export default function Empresas() {
  const { me, recarregar } = usePainel();
  const [empresas, setEmpresas] = useState<any[]>([]);
  const [modulos, setModulos] = useState<any[]>([]);
  const [formulario, setFormulario] = useState<'nova' | string | null>(null);   // 'nova' ou o id da empresa em edição
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
        {!formulario && <button className="btn primario" onClick={() => { setFormulario('nova'); setMsg(''); }}>Nova empresa</button>}
      </div>
      {msg && <div className="aviso ok" style={{ marginBottom: 12 }}>{msg}</div>}

      {formulario && <FormEmpresa key={formulario} empresaId={formulario === 'nova' ? undefined : formulario} modulos={modulos}
        onCancelar={() => setFormulario(null)}
        onSalva={(e) => {
          setMsg(formulario === 'nova' ? `Empresa ${e.nome} criada. Código de acesso: ${e.slug}` : `Cadastro de ${e.nome} salvo. Código de acesso: ${e.slug}`);
          if (formulario === 'nova') setAberta(e.id);
          // a própria empresa do master: menu (nome e logo) atualiza na hora
          if (e.id === me.empresa.id) recarregar();
          setFormulario(null); carregar();
        }} />}

      <section className="cartao">
        <div className="tabela"><table>
          <thead><tr><th>Empresa</th><th>Código de acesso</th><th>Situação</th><th>Usuários ativos</th><th>Módulos</th><th></th></tr></thead>
          <tbody>
            {empresas.map((e) => (
              <FragmentoEmpresa key={e.id} e={e} aberta={aberta === e.id} nomeModulo={nomeModulo}
                propria={e.slug === me.empresa.slug}
                onAbrir={() => setAberta(aberta === e.id ? null : e.id)}
                onEditar={() => { setFormulario(e.id); setMsg(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
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

function FragmentoEmpresa({ e, aberta, propria, nomeModulo, onAbrir, onEditar, onSituacao, onMudou }: {
  e: any; aberta: boolean; propria: boolean; nomeModulo: (c: string) => string;
  onAbrir: () => void; onEditar: () => void; onSituacao: () => void; onMudou: () => void;
}) {
  return (
    <>
      <tr>
        <td><strong>{e.nome}</strong>
          <div className="suave pequeno">
            {e.razao_social && e.razao_social !== e.nome && <>{e.razao_social} · </>}
            {e.cnpj ? `CNPJ ${mascara.cnpj(e.cnpj)} · ` : e.cpf ? `CPF ${mascara.cpf(e.cpf)} · ` : ''}
            {e.cidade && `${e.cidade}/${e.uf} · `}desde {fmt.data(e.criado_em)}
          </div></td>
        <td><code>{e.slug}</code></td>
        <td>{e.ativo ? <span className="etiqueta ok">ativa</span> : <span className="etiqueta neutra">inativa</span>}</td>
        <td>{e.usuarios}</td>
        <td className="pequeno" title={e.modulos.filter((x: string) => x !== 'DP').map(nomeModulo).join(', ')}>{e.modulos.filter((x: string) => x !== 'DP').join(', ') || '—'}</td>
        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
          <button className="btn pequeno" onClick={onEditar}>Editar</button>{' '}
          <button className="btn pequeno" onClick={onAbrir}>{aberta ? 'Fechar' : 'Usuários'}</button>{' '}
          {!propria && <button className={`btn pequeno ${e.ativo ? 'perigo' : ''}`} onClick={onSituacao}>{e.ativo ? 'Inativar' : 'Reativar'}</button>}
        </td>
      </tr>
      {aberta && <tr><td colSpan={6} style={{ background: 'var(--bg)' }}><UsuariosEmpresa empresa={e} onMudou={onMudou} /></td></tr>}
    </>
  );
}

/** Cadastro da empresa: os mesmos dados do cliente, mais código de acesso, logo, módulos e (na criação) a administradora */
function FormEmpresa({ empresaId, modulos, onCancelar, onSalva }: {
  empresaId?: string; modulos: any[]; onCancelar: () => void; onSalva: (e: any) => void;
}) {
  const [c, setC] = useState<any>(empresaId ? null : { pessoa: 'juridica', modulos: ['M1', 'M3', 'M4', 'M5', 'M7', 'BI'], prazos_eventos: PRAZOS_PADRAO });
  const [slugManual, setSlugManual] = useState(!!empresaId);
  const [slugOriginal, setSlugOriginal] = useState('');
  const [admin, setAdmin] = useState({ nome: '', email: '', senha: '' });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!empresaId) return;
    api(`/empresas/${empresaId}`).then((e) => { setC(e); setSlugOriginal(e.slug); }).catch((e) => setErro(e.message));
  }, [empresaId]);

  if (!c) return <div className="cartao" style={{ marginBottom: 16 }}>{erro ? <div className="aviso erro">{erro}</div> : <span className="suave">Carregando…</span>}</div>;

  const set = (k: string, v: unknown) => setC((x: any) => {
    const n = { ...x, [k]: v };
    // código de acesso sugerido pelo nome, até alguém mexer nele
    if (!slugManual && (k === 'nome_fantasia' || k === 'razao_social')) n.slug = paraCodigo(n.nome_fantasia || n.razao_social || '');
    return n;
  });
  const alternar = (m: string) => set('modulos', c.modulos.includes(m) ? c.modulos.filter((x: string) => x !== m) : [...c.modulos, m]);

  async function escolherLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    try { set('logo', await prepararLogo(arquivo)); } catch (x: any) { setErro(x.message); }
  }

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro(''); setSalvando(true);
    const corpo = { ...corpoCadastro(c), slug: c.slug, modulos: c.modulos, logo: c.logo ?? null, prazos_eventos: c.prazos_eventos ?? PRAZOS_PADRAO };
    try {
      onSalva(empresaId
        ? await api(`/empresas/${empresaId}`, { method: 'PUT', json: corpo })
        : await api('/empresas', { method: 'POST', json: { ...corpo, admin } }));
    } catch (e: any) {
      setErro(e.dados?.campos?.[0]?.mensagem ?? e.message);
    } finally { setSalvando(false); }
  }

  return (
    <form className="cartao form" style={{ marginBottom: 16 }} onSubmit={salvar}>
      <h2 style={{ margin: 0 }}>{empresaId ? `Editar ${c.nome_fantasia}` : 'Nova empresa'}</h2>

      <CamposIdentificacao c={c} set={set} />
      <div className="linha">
        <label>Código de acesso (usado no login)
          <input required value={c.slug ?? ''} pattern="[a-z0-9][a-z0-9\-]{1,39}" title="Letras minúsculas, números ou hífen"
                 onChange={(e) => { setSlugManual(true); set('slug', e.target.value.toLowerCase()); }} /></label>
      </div>
      {empresaId && c.slug !== slugOriginal && (
        <div className="aviso">Ao trocar o código, os usuários de {c.nome_fantasia} passam a entrar com <code>{c.slug}</code> em vez de <code>{slugOriginal}</code>. Avise a equipe.</div>
      )}
      <CamposContato c={c} set={set} />
      <CamposRedes c={c} set={set} />
      <CamposEndereco c={c} set={set} />

      <div className="suave pequeno" style={{ fontWeight: 600 }}>Logo</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <LogoEmpresa nome={c.nome_fantasia || c.razao_social || '?'} logo={c.logo} tamanho={48} />
        <label className="btn pequeno" style={{ cursor: 'pointer' }}>
          {c.logo ? 'Trocar logo' : 'Enviar logo'}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={escolherLogo} />
        </label>
        {c.logo && <button type="button" className="btn pequeno" onClick={() => set('logo', null)}>Remover</button>}
        <span className="suave pequeno">PNG com fundo transparente ou SVG. Aparece no menu e na página do profissional.</span>
      </div>

      <div className="suave pequeno" style={{ fontWeight: 600 }}>Cores do prazo dos eventos</div>
      <ConfigPrazos valor={c.prazos_eventos ?? PRAZOS_PADRAO} onChange={(p) => set('prazos_eventos', p)} />

      <div>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Módulos liberados</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px' }}>
          {modulos.filter((m) => !m.so_permissao).map((m) => (
            <label key={m.codigo} style={{ display: 'flex', gap: 6, alignItems: 'center', fontWeight: 400 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={c.modulos.includes(m.codigo)} onChange={() => alternar(m.codigo)} />
              {m.codigo} — {m.nome}
            </label>
          ))}
        </div>
        <div className="suave pequeno" style={{ marginTop: 4 }}>A administradora da empresa também pode ajustar em Módulos e acessos.</div>
      </div>

      {!empresaId && <>
        <div style={{ fontWeight: 600 }}>Administradora da empresa (primeiro acesso)</div>
        <div className="linha">
          <label>Nome<input required value={admin.nome} onChange={(e) => setAdmin({ ...admin, nome: e.target.value })} /></label>
          <label>E-mail<input required type="email" value={admin.email} onChange={(e) => setAdmin({ ...admin, email: e.target.value })} /></label>
          <label>Senha inicial<input required type="password" minLength={8} autoComplete="new-password" value={admin.senha}
                                      onChange={(e) => setAdmin({ ...admin, senha: e.target.value })} /></label>
        </div>
      </>}

      {erro && <div className="aviso erro">{erro}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : empresaId ? 'Salvar' : 'Criar empresa'}</button>
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
