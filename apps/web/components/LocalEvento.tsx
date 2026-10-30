'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { mascara } from '@/lib/ui';
import { FotosLocal } from './FotosLocal';
import { Geolocalizacao } from './Geolocalizacao';

/** Cartão "Local do evento" no detalhe: contato do local, geolocalização e fotos */
export function LocalEvento({ ev, podeEditar, onMudou }: { ev: any; podeEditar: boolean; onMudou: () => void }) {
  const fechado = ev.status === 'fechado';
  const editavel = podeEditar && !fechado;
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState<any>({});
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [editandoObs, setEditandoObs] = useState(false);
  const [obs, setObs] = useState('');

  /** Grava no evento; devolve uma promessa que só resolve se deu certo (para fechar o formulário) */
  async function salvar(dados: Record<string, unknown>) {
    setErro(''); setSalvando(true);
    try { await api(`/eventos/${ev.id}`, { method: 'PATCH', json: dados }); setEditando(false); onMudou(); }
    catch (e: any) { setErro(e.dados?.campos?.[0]?.mensagem ?? e.message); throw e; }
    finally { setSalvando(false); }
  }

  const temContato = ev.contato_local_nome || ev.contato_local_telefone || ev.contato_local_email;
  const enderecoBusca = [ev.endereco, ev.praca].filter(Boolean).join(', ');

  return (
    <section className="cartao" style={{ marginBottom: 16 }}>
      <h2>Local do evento</h2>
      <div className="grade g2" style={{ alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div className="pequeno">
            <strong>{ev.local_nome ?? 'Local não informado'}</strong>
            <div className="suave">{[ev.endereco, ev.praca, ev.cep && `CEP ${mascara.cep(ev.cep)}`].filter(Boolean).join(' · ') || 'Endereço não informado'}</div>
          </div>

          <div>
            <div className="suave pequeno" style={{ fontWeight: 600, marginBottom: 4 }}>Observações</div>
            {editandoObs ? (
              <form className="form" onSubmit={(e) => { e.preventDefault(); salvar({ observacoes: obs.trim() || null }).then(() => setEditandoObs(false), () => undefined); }}>
                <textarea rows={4} maxLength={5000} autoFocus value={obs} onChange={(e) => setObs(e.target.value)}
                          placeholder="Ex.: Pausa para almoço das 12h às 14h." />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar observações'}</button>
                  <button type="button" className="btn" onClick={() => setEditandoObs(false)}>Cancelar</button>
                </div>
              </form>
            ) : (
              <div className="pequeno">
                {ev.observacoes ? <div style={{ whiteSpace: 'pre-wrap' }}>{ev.observacoes}</div> : <span className="suave">Nenhuma observação.</span>}
                {editavel && <div style={{ marginTop: 6 }}><button className="btn pequeno" onClick={() => { setObs(ev.observacoes ?? ''); setEditandoObs(true); }}>
                  {ev.observacoes ? 'Editar observações' : 'Adicionar observações'}</button></div>}
              </div>
            )}
          </div>

          <div>
            <div className="suave pequeno" style={{ fontWeight: 600, marginBottom: 4 }}>Contato do local</div>
            {editando ? (
              <form className="form" onSubmit={(e) => { e.preventDefault(); salvar({
                contato_local_nome: form.nome?.trim() || null, contato_local_telefone: form.telefone?.trim() || null, contato_local_email: form.email?.trim() || null })
                .catch(() => undefined); }}>
                <label>Nome<input value={form.nome ?? ''} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></label>
                <label>Telefone<input inputMode="tel" value={form.telefone ?? ''} onChange={(e) => setForm({ ...form, telefone: mascara.telefone(e.target.value) })} /></label>
                <label>E-mail<input type="email" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar contato'}</button>
                  <button type="button" className="btn" onClick={() => setEditando(false)}>Cancelar</button>
                </div>
              </form>
            ) : (
              <div className="pequeno">
                {temContato ? (
                  <>
                    <div><strong>{ev.contato_local_nome ?? '—'}</strong></div>
                    {ev.contato_local_telefone && <div><a href={`tel:${ev.contato_local_telefone.replace(/\D/g, '')}`}>{ev.contato_local_telefone}</a>
                      {' · '}<a target="_blank" rel="noopener noreferrer" href={`https://wa.me/55${ev.contato_local_telefone.replace(/\D/g, '')}`}>WhatsApp</a></div>}
                    {ev.contato_local_email && <div><a href={`mailto:${ev.contato_local_email}`}>{ev.contato_local_email}</a></div>}
                  </>
                ) : <span className="suave">Nenhum contato do local cadastrado.</span>}
                {editavel && <div style={{ marginTop: 6 }}><button className="btn pequeno" onClick={() => {
                  setForm({ nome: ev.contato_local_nome, telefone: ev.contato_local_telefone, email: ev.contato_local_email }); setEditando(true); }}>
                  {temContato ? 'Editar contato' : 'Adicionar contato'}</button></div>}
              </div>
            )}
          </div>

          <div>
            <div className="suave pequeno" style={{ fontWeight: 600, marginBottom: 4 }}>Geolocalização {ev.exige_geolocalizacao && <span className="etiqueta">exigida no check-in</span>}</div>
            {editavel
              ? <Geolocalizacao endereco={enderecoBusca} valor={{ latitude: ev.latitude != null ? Number(ev.latitude) : null, longitude: ev.longitude != null ? Number(ev.longitude) : null }}
                                onChange={(g) => { salvar(g).catch(() => undefined); }} />
              : <span className="pequeno">{ev.latitude != null ? `📍 ${Number(ev.latitude).toFixed(5)}, ${Number(ev.longitude).toFixed(5)}` : <span className="suave">Não informada</span>}</span>}
          </div>
          {erro && <div className="aviso erro">{erro}</div>}
          {fechado && <div className="suave pequeno">Evento fechado: o local não pode mais ser alterado.</div>}
        </div>

        <div>
          <div className="suave pequeno" style={{ fontWeight: 600, marginBottom: 6 }}>Fotos do local</div>
          <FotosLocal eventoId={ev.id} podeEditar={editavel} />
        </div>
      </div>
    </section>
  );
}
