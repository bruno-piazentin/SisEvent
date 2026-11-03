'use client';
import { Fragment, useEffect, useState } from 'react';
import { api, fmt } from '@/lib/api';
import { usePainel } from '@/components/Painel';
import { LogoEmpresa } from '@/components/Marca';
import { prepararLogo } from '@/lib/imagem';
import { Confirmar } from '@/components/Confirmar';

const ACOES = ['ver', 'criar', 'editar', 'excluir', 'aprovar', 'ver_valores'] as const;
const ROTULO_ACAO: Record<string, string> = { ver: 'Ver', criar: 'Criar', editar: 'Editar', excluir: 'Excluir', aprovar: 'Aprovar', ver_valores: 'Valores' };
// DP (dados pessoais) é só uma permissão: tem apenas "Ver" (que também libera alterar esses campos)
const temAcao = (m: any, a: string) => !m.so_permissao || a === 'ver';

/** Liberação por módulos: empresa (contrato) → perfil → ajuste por usuário */
export default function Admin() {
  const { me } = usePainel();
  const [modulos, setModulos] = useState<any[]>([]);
  const [perfis, setPerfis] = useState<any[]>([]);
  const [usuarios, setUsuarios] = useState<any[]>([]);
  const [msg, setMsg] = useState('');

  const carregar = () => Promise.all([api('/admin/modulos'), api('/admin/perfis'), api('/admin/usuarios')])
    .then(([m, p, u]) => { setModulos(m); setPerfis(p); setUsuarios(u); });
  useEffect(() => { carregar(); }, []);

  if (me.usuario.perfil !== 'admin') return <div className="cartao">Somente a administradora acessa esta área.</div>;

  async function alternarModulo(m: any) {
    await api(`/admin/modulos/${m.codigo}`, { method: 'PUT', json: { ativo: !m.liberado } });
    setMsg(`${m.codigo} ${m.liberado ? 'bloqueado' : 'liberado'}. Os usuários veem a mudança no próximo carregamento.`);
    carregar();
  }

  async function alternarPermissao(perfil: any, modulo: string, acao: string) {
    const tem = perfil.permissoes.some((p: any) => p.modulo === modulo && p.acao === acao);
    const novas = tem ? perfil.permissoes.filter((p: any) => !(p.modulo === modulo && p.acao === acao)) : [...perfil.permissoes, { modulo, acao }];
    await api(`/admin/perfis/${perfil.id}/permissoes`, { method: 'PUT', json: { permissoes: novas } });
    carregar();
  }

  return (
    <>
      <div className="topo"><div><h1>Módulos e acessos</h1>
        <div className="suave">Um módulo só aparece para alguém se estiver liberado para a empresa E permitido no perfil (ou no ajuste individual).</div></div></div>
      {msg && <div className="aviso ok" style={{ marginBottom: 12 }}>{msg}</div>}

      <LogoDaEmpresa />

      <section className="cartao" style={{ marginBottom: 16 }}>
        <h2>1. Módulos liberados para a empresa</h2>
        <div className="tabela"><table>
          <thead><tr><th>Módulo</th><th>Fase</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {modulos.filter((m) => !m.so_permissao).map((m) => (
              <tr key={m.codigo}>
                <td><strong>{m.codigo} — {m.nome}</strong><div className="suave pequeno">{m.descricao}</div></td>
                <td>Fase {m.fase}</td>
                <td>{m.liberado ? <span className="etiqueta ok">liberado {m.liberado_em && `em ${fmt.data(m.liberado_em)}`}</span> : <span className="etiqueta neutra">bloqueado</span>}</td>
                <td style={{ textAlign: 'right' }}><button className={`btn pequeno ${m.liberado ? 'perigo' : 'primario'}`} onClick={() => alternarModulo(m)}>{m.liberado ? 'Bloquear' : 'Liberar'}</button></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>

      <section className="cartao" style={{ marginBottom: 16 }}>
        <h2>2. Permissões por perfil</h2>
        {perfis.filter((p) => !p.acesso_total).map((perfil) => (
          <details key={perfil.id} style={{ borderTop: '1px solid var(--borda)', padding: '10px 0' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{perfil.nome} <span className="suave pequeno">({perfil.permissoes.length} permissões)</span></summary>
            <div className="tabela"><table style={{ marginTop: 8 }}>
              <thead><tr><th>Módulo</th>{ACOES.map((a) => <th key={a}>{ROTULO_ACAO[a]}</th>)}</tr></thead>
              <tbody>
                {modulos.map((m) => (
                  <tr key={m.codigo} style={{ opacity: m.liberado ? 1 : 0.45 }}>
                    <td>{m.codigo} {m.nome}{m.so_permissao && <div className="suave pequeno">CPF, RG, nascimento e dados bancários</div>}</td>
                    {ACOES.map((a) => (
                      <td key={a}>{temAcao(m, a) && <input type="checkbox" style={{ width: 'auto' }}
                        checked={perfil.permissoes.some((p: any) => p.modulo === m.codigo && p.acao === a)}
                        onChange={() => alternarPermissao(perfil, m.codigo, a)} />}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table></div>
          </details>
        ))}
        <p className="suave pequeno">Administradora tem acesso total aos módulos liberados.</p>
      </section>

      <Usuarios usuarios={usuarios} perfis={perfis} modulos={modulos} onMudou={carregar} />
    </>
  );
}

/** Logo da empresa: aparece no menu do painel e na área do profissional (link do WhatsApp) */
function LogoDaEmpresa() {
  const { me, recarregar } = usePainel();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar(logo: string | null) {
    setErro(''); setEnviando(true);
    try {
      await api('/admin/logo', { method: 'PUT', json: { logo } });
      await recarregar();
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setEnviando(false);
    }
  }

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = '';
    if (!arquivo) return;
    try { await salvar(await prepararLogo(arquivo)); } catch (x: any) { setErro(x.message); }
  }

  return (
    <section className="cartao" style={{ marginBottom: 16 }}>
      <h2>Logo da empresa</h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ padding: 12, border: '1px dashed var(--borda)', borderRadius: 10, minWidth: 96, display: 'grid', placeItems: 'center' }}>
          <LogoEmpresa nome={me.empresa.nome} logo={me.empresa.logo} tamanho={64} />
        </div>
        <div>
          <p className="suave pequeno" style={{ marginTop: 0 }}>
            Aparece no menu do painel e na página que o profissional abre pelo link do WhatsApp.
            Use PNG com fundo transparente ou SVG; a imagem é reduzida automaticamente.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <label className="btn primario pequeno" style={{ cursor: 'pointer' }} aria-disabled={enviando}>
              {enviando ? 'Enviando…' : me.empresa.logo ? 'Trocar logo' : 'Enviar logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden disabled={enviando} onChange={escolher} />
            </label>
            {me.empresa.logo && <button className="btn pequeno" disabled={enviando} onClick={() => salvar(null)}>Remover</button>}
          </div>
          {erro && <div className="aviso erro" style={{ marginTop: 8 }}>{erro}</div>}
        </div>
      </div>
    </section>
  );
}

const PERFIS: Record<string, string> = { admin: 'Administradora', central: 'Central', supervisor: 'Supervisor', financeiro: 'Financeiro' };

/** Camada 3: usuários da empresa (perfil, situação, senha) e permissões individuais acima do perfil */
function Usuarios({ usuarios, perfis, modulos, onMudou }: { usuarios: any[]; perfis: any[]; modulos: any[]; onMudou: () => Promise<unknown> }) {
  const { me } = usePainel();
  const [aberto, setAberto] = useState<string | null>(null);
  const [senhaDe, setSenhaDe] = useState<string | null>(null);
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState<any>(null);
  const [novo, setNovo] = useState({ nome: '', email: '', perfil: 'central', senha: '' });
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');

  /** Executa e devolve se deu certo (para só limpar o formulário quando salvou) */
  async function executar(acao: () => Promise<unknown>, ok: string) {
    setErro(''); setMsg('');
    try { await acao(); setMsg(ok); await onMudou(); return true; }
    catch (e: any) { setErro(e.codigo === 'duplicado' ? 'Já existe um usuário com esse e-mail.' : e.dados?.campos?.[0]?.mensagem ?? e.message); return false; }
  }
  const editar = (u: any, json: any, ok: string) => executar(() => api(`/admin/usuarios/${u.id}`, { method: 'PUT', json }), ok);

  return (
    <section className="cartao">
      <h2>3. Usuários e permissões individuais</h2>
      <p className="suave pequeno" style={{ marginTop: 0 }}>
        Cada usuário segue o perfil dele. Em <span className="botao">Permissões</span> você libera ou bloqueia algo só para uma pessoa, sem mudar o perfil.
      </p>
      {msg && <div className="aviso ok" style={{ marginBottom: 8 }}>{msg}</div>}
      {erro && <div className="aviso erro" style={{ marginBottom: 8 }}>{erro}</div>}
      <div className="tabela"><table>
        <thead><tr><th>Nome</th><th>Perfil</th><th>Situação</th><th>Último acesso</th><th></th></tr></thead>
        <tbody>
          {usuarios.map((u) => {
            const proprio = u.id === me.usuario.id;
            const travado = proprio || u.master;
            return (
              <Fragment key={u.id}>
                <tr style={{ opacity: u.ativo ? 1 : 0.55 }}>
                  <td>{u.nome}
                    {proprio && <span className="etiqueta neutra" style={{ marginLeft: 6 }}>você</span>}
                    {u.master && <span className="etiqueta neutra" style={{ marginLeft: 6 }}>manutenção</span>}
                    <div className="suave pequeno">{u.email}</div>
                    {u.ajustes.length > 0 && <div className="pequeno" style={{ color: 'var(--primaria)' }}>{u.ajustes.length} permissão(ões) individual(is)</div>}
                  </td>
                  <td>
                    <select value={u.perfil} disabled={travado} title={travado ? 'Não é possível mudar este perfil' : undefined}
                            onChange={(e) => editar(u, { perfil: e.target.value }, `Perfil de ${u.nome} alterado para ${PERFIS[e.target.value]}.`)}>
                      {Object.entries(PERFIS).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                    </select>
                  </td>
                  <td>{u.ativo ? <span className="etiqueta ok">ativo</span> : <span className="etiqueta neutra">inativo</span>}</td>
                  <td className="pequeno">{fmt.dataHora(u.ultimo_acesso)}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {u.master ? <span className="suave pequeno">usuário do SisEvent</span> : senhaDe === u.id ? (
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
                        {u.perfil !== 'admin' && (
                          <button className={`btn pequeno ${aberto === u.id ? 'primario' : ''}`} onClick={() => setAberto(aberto === u.id ? null : u.id)}>Permissões</button>
                        )}{' '}
                        <button className="btn pequeno" onClick={() => { setSenhaDe(u.id); setSenha(''); }}>Redefinir senha</button>{' '}
                        {!proprio && <button className={`btn pequeno ${u.ativo ? 'perigo' : ''}`} onClick={() => setConfirmar(u)}>{u.ativo ? 'Inativar' : 'Reativar'}</button>}
                      </>
                    )}
                  </td>
                </tr>
                {aberto === u.id && !u.master && u.perfil !== 'admin' && (
                  <tr><td colSpan={5} style={{ background: 'var(--bg)' }}>
                    <PermissoesUsuario usuario={u} perfil={perfis.find((p) => p.codigo === u.perfil)} modulos={modulos}
                      onAjustar={(json, ok) => executar(() => api(`/admin/usuarios/${u.id}/ajustes`, { method: 'PUT', json }), ok)} />
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table></div>

      <form className="form" style={{ marginTop: 16 }} onSubmit={(ev) => {
        ev.preventDefault();
        executar(() => api('/admin/usuarios', { method: 'POST', json: novo }),
          `${novo.nome} cadastrado. Informe o código da empresa (${me.empresa.slug}), o e-mail e a senha.`)
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

      {confirmar && (
        <Confirmar titulo={confirmar.ativo ? 'Inativar usuário?' : 'Reativar usuário?'} rotulo={confirmar.ativo ? 'Sim, inativar' : 'Sim, reativar'}
          perigo={confirmar.ativo} onCancelar={() => setConfirmar(null)}
          onConfirmar={async () => {
            await editar(confirmar, { ativo: !confirmar.ativo }, `${confirmar.nome} ${confirmar.ativo ? 'inativado' : 'reativado'}.`);
            setConfirmar(null);
          }}>
          {confirmar.ativo
            ? <p><strong>{confirmar.nome}</strong> deixa de conseguir entrar no sistema. O histórico do que ele fez continua guardado.</p>
            : <p><strong>{confirmar.nome}</strong> volta a conseguir entrar, com o mesmo perfil e as mesmas permissões.</p>}
        </Confirmar>
      )}
    </section>
  );
}

/**
 * Matriz módulo × ação de um usuário. Cada casa mostra o que vale para ele:
 * pelo perfil (cinza) ou ajuste individual (verde = liberado só para ele, vermelho = bloqueado só para ele).
 * Clicar inverte; se o resultado voltar a ser igual ao perfil, o ajuste é removido.
 */
function PermissoesUsuario({ usuario, perfil, modulos, onAjustar }: {
  usuario: any; perfil: any; modulos: any[]; onAjustar: (json: any, ok: string) => Promise<boolean>;
}) {
  const liberados = modulos.filter((m) => m.liberado);
  const doPerfil = (m: string, a: string) => !!perfil?.acesso_total || !!perfil?.permissoes.some((p: any) => p.modulo === m && p.acao === a);
  const ajuste = (m: string, a: string) => usuario.ajustes.find((x: any) => x.modulo === m && x.acao === a);

  function alternar(m: string, a: string) {
    const aj = ajuste(m, a);
    const novo = !(aj ? aj.concedido : doPerfil(m, a));
    const concedido = novo === doPerfil(m, a) ? null : novo;
    onAjustar({ modulo: m, acao: a, concedido },
      `${m} · ${ROTULO_ACAO[a]}: ${concedido === null ? 'voltou ao perfil' : concedido ? 'liberado' : 'bloqueado'} para ${usuario.nome}.`);
  }

  return (
    <div style={{ padding: '8px 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Permissões de {usuario.nome} <span className="suave pequeno">(perfil {PERFIS[usuario.perfil]})</span></h3>
        {usuario.ajustes.length > 0 && (
          <button className="btn pequeno" onClick={async () => {
            for (const a of usuario.ajustes) await onAjustar({ modulo: a.modulo, acao: a.acao, concedido: null }, `Permissões de ${usuario.nome} voltaram ao perfil.`);
          }}>Voltar tudo ao perfil</button>
        )}
      </div>
      <div className="suave pequeno" style={{ margin: '6px 0 8px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <span><span className="perm sim">✓</span> pelo perfil</span>
        <span><span className="perm sim ajuste">✓</span> liberado só para ele</span>
        <span><span className="perm nao ajuste">×</span> bloqueado só para ele</span>
        <span>Clique para mudar. Módulos bloqueados para a empresa não aparecem.</span>
      </div>
      <div className="tabela"><table>
        <thead><tr><th>Módulo</th>{ACOES.map((a) => <th key={a} style={{ textAlign: 'center' }}>{ROTULO_ACAO[a]}</th>)}</tr></thead>
        <tbody>
          {liberados.map((m) => (
            <tr key={m.codigo}>
              <td>{m.codigo} {m.nome}{m.so_permissao && <div className="suave pequeno">CPF, RG, nascimento e dados bancários</div>}</td>
              {ACOES.map((a) => {
                const aj = ajuste(m.codigo, a);
                const vale = aj ? aj.concedido : doPerfil(m.codigo, a);
                const rotulo = aj ? (aj.concedido ? 'liberado só para este usuário' : 'bloqueado só para este usuário')
                  : (vale ? 'permitido pelo perfil' : 'o perfil não permite');
                if (!temAcao(m, a)) return <td key={a} />;
                return (
                  <td key={a} style={{ textAlign: 'center' }}>
                    <button type="button" className={`perm ${vale ? 'sim' : 'nao'} ${aj ? 'ajuste' : ''}`} title={`${ROTULO_ACAO[a]}: ${rotulo}`}
                            aria-label={`${m.codigo} ${ROTULO_ACAO[a]}: ${rotulo}`} onClick={() => alternar(m.codigo, a)}>{vale ? '✓' : '×'}</button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table></div>
    </div>
  );
}
