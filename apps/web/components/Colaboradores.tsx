'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { mascara, nomeColaborador } from '@/lib/ui';

const VAZIO = { nome: '', sobrenome: '', apelido: '', cargo: '', email: '', telefone: '', principal: false };

/** Colaboradores (agentes) vinculados à empresa cliente: a base de contato. Aceita quantos forem necessários. */
export function Colaboradores({ clienteId, lista, podeEditar, onMudou }:
  { clienteId: string; lista: any[]; podeEditar: boolean; onMudou: () => void }) {
  const [form, setForm] = useState<any>(null);   // null = fechado; sem id = novo
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const set = (k: string, v: unknown) => setForm((f: any) => ({ ...f, [k]: v }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const corpo: any = { principal: !!form.principal };
    for (const k of ['nome', 'sobrenome', 'apelido', 'cargo', 'email', 'telefone']) corpo[k] = form[k]?.trim() || null;
    try {
      if (form.id) await api(`/contatos/${form.id}`, { method: 'PATCH', json: corpo });
      else await api(`/clientes/${clienteId}/contatos`, { method: 'POST', json: corpo });
      setForm(null); onMudou();
    } catch (e: any) {
      setErro(e.dados?.campos?.[0]?.mensagem ?? e.message);
    } finally { setSalvando(false); }
  }

  async function remover(ct: any) {
    if (!confirm(`Remover ${nomeColaborador(ct)} dos colaboradores deste cliente?`)) return;
    try { await api(`/contatos/${ct.id}`, { method: 'DELETE' }); onMudou(); } catch (e: any) { alert(e.message); }
  }

  return (
    <section className="cartao">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Colaboradores <span className="suave pequeno" style={{ fontWeight: 400 }}>· {lista.length}</span></h2>
        {podeEditar && !form && <button className="btn pequeno primario" onClick={() => { setErro(''); setForm({ ...VAZIO, principal: lista.length === 0 }); }}>Adicionar colaborador</button>}
      </div>

      {form && (
        <form className="form" onSubmit={salvar} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid var(--borda)' }}>
          <div className="linha">
            <label>Nome *<input required value={form.nome} onChange={(e) => set('nome', e.target.value)} /></label>
            <label>Sobrenome<input value={form.sobrenome ?? ''} onChange={(e) => set('sobrenome', e.target.value)} /></label>
            <label>Apelido<input value={form.apelido ?? ''} onChange={(e) => set('apelido', e.target.value)} /></label>
          </div>
          <div className="linha">
            <label>Cargo<input value={form.cargo ?? ''} onChange={(e) => set('cargo', e.target.value)} /></label>
            <label>E-mail<input type="email" value={form.email ?? ''} onChange={(e) => set('email', e.target.value)} /></label>
            <label>Telefone de contato<input inputMode="tel" placeholder="(00) 00000-0000" value={mascara.telefone(form.telefone)} onChange={(e) => set('telefone', mascara.telefone(e.target.value))} /></label>
          </div>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--texto)' }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={!!form.principal} onChange={(e) => set('principal', e.target.checked)} />
            Contato principal da empresa
          </label>
          {erro && <div className="aviso erro">{erro}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : form.id ? 'Salvar alterações' : 'Adicionar'}</button>
            <button type="button" className="btn" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {lista.length === 0 && !form && <p className="suave">Nenhum colaborador vinculado. Adicione as pessoas de contato desta empresa.</p>}
      <table>
        <tbody>
          {lista.map((ct) => (
            <tr key={ct.id}>
              <td>
                <strong>{nomeColaborador(ct)}</strong>{ct.apelido && <span className="suave"> ({ct.apelido})</span>}
                {ct.principal && <span className="etiqueta" style={{ marginLeft: 6 }}>principal</span>}
                <div className="suave pequeno">{ct.cargo ?? 'Sem cargo informado'}</div>
              </td>
              <td className="pequeno">
                {ct.telefone ?? '—'}
                <div>{ct.email ? <a href={`mailto:${ct.email}`}>{ct.email}</a> : <span className="suave">sem e-mail</span>}</div>
              </td>
              {podeEditar && (
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="btn pequeno" onClick={() => { setErro(''); setForm({ ...ct }); }}>Editar</button>{' '}
                  <button className="btn pequeno perigo" onClick={() => remover(ct)}>Remover</button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
