'use client';
import { useEffect, useState } from 'react';
import { api, fmt } from '@/lib/api';
import { usePainel } from '@/components/Painel';

const ACOES = ['ver', 'criar', 'editar', 'excluir', 'aprovar', 'ver_valores'] as const;
const ROTULO_ACAO: Record<string, string> = { ver: 'Ver', criar: 'Criar', editar: 'Editar', excluir: 'Excluir', aprovar: 'Aprovar', ver_valores: 'Valores' };

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

      <section className="cartao" style={{ marginBottom: 16 }}>
        <h2>1. Módulos liberados para a empresa</h2>
        <div className="tabela"><table>
          <thead><tr><th>Módulo</th><th>Fase</th><th>Situação</th><th></th></tr></thead>
          <tbody>
            {modulos.map((m) => (
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
                    <td>{m.codigo} {m.nome}</td>
                    {ACOES.map((a) => (
                      <td key={a}><input type="checkbox" style={{ width: 'auto' }}
                        checked={perfil.permissoes.some((p: any) => p.modulo === m.codigo && p.acao === a)}
                        onChange={() => alternarPermissao(perfil, m.codigo, a)} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table></div>
          </details>
        ))}
        <p className="suave pequeno">Administradora tem acesso total aos módulos liberados.</p>
      </section>

      <section className="cartao">
        <h2>3. Usuários e ajustes individuais</h2>
        <table>
          <thead><tr><th>Nome</th><th>Perfil</th><th>Ajustes</th><th>Último acesso</th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}><td>{u.nome}<div className="suave pequeno">{u.email}</div></td><td>{u.perfil}</td>
                <td className="pequeno">{u.ajustes.length ? u.ajustes.map((a: any) => `${a.concedido ? '+' : '−'} ${a.modulo}:${a.acao}`).join(', ') : '—'}</td>
                <td className="pequeno">{fmt.dataHora(u.ultimo_acesso)}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
