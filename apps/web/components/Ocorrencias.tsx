'use client';
import { useEffect, useRef, useState } from 'react';
import { api, fmt } from '@/lib/api';

/**
 * Botão "Ocorrências" da ficha (cliente ou profissional): abre o histórico e um campo de texto livre.
 * Ocorrência registrada não é editada nem apagada — fica como histórico, com quem registrou e quando.
 */
export function Ocorrencias({ caminho, nome, podeRegistrar }: { caminho: string; nome: string; podeRegistrar: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [lista, setLista] = useState<any[] | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

  const carregar = () => api(`${caminho}/ocorrencias`).then(setLista).catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, [caminho]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!aberto) return;
    campo.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setAberto(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [aberto]);

  async function registrar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    try {
      await api(`${caminho}/ocorrencias`, { method: 'POST', json: { texto } });
      setTexto(''); await carregar();
    } catch (e: any) { setErro(e.dados?.campos?.[0]?.mensagem ?? e.message); } finally { setSalvando(false); }
  }

  return (
    <>
      <button className="btn" onClick={() => setAberto(true)}>
        Ocorrências{lista && lista.length > 0 && <span className="etiqueta alerta">{lista.length}</span>}
      </button>

      {aberto && (
        <div role="presentation" onClick={() => setAberto(false)}
             style={{ position: 'fixed', inset: 0, background: 'rgba(20,10,30,.45)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 50 }}>
          <div role="dialog" aria-modal="true" aria-labelledby="ocorrencias-titulo" className="cartao" onClick={(e) => e.stopPropagation()}
               style={{ maxWidth: 620, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
              <div><h2 id="ocorrencias-titulo" style={{ marginBottom: 2 }}>Ocorrências</h2><div className="suave pequeno">{nome}</div></div>
              <button className="btn pequeno" onClick={() => setAberto(false)} aria-label="Fechar">Fechar</button>
            </div>

            {podeRegistrar && (
              <form className="form" onSubmit={registrar} style={{ margin: '14px 0', paddingBottom: 14, borderBottom: '1px solid var(--borda)' }}>
                <label>Nova ocorrência
                  <textarea ref={campo} rows={4} maxLength={5000} required value={texto} onChange={(e) => setTexto(e.target.value)}
                            placeholder="Descreva o que aconteceu: data, pessoas envolvidas, combinados…" />
                </label>
                {erro && <div className="aviso erro">{erro}</div>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span className="suave pequeno">Fica registrada com seu nome, data e hora, e não pode ser apagada.</span>
                  <button className="btn primario" disabled={salvando || texto.trim().length < 3}>{salvando ? 'Registrando…' : 'Registrar'}</button>
                </div>
              </form>
            )}

            <div style={{ overflowY: 'auto', marginTop: podeRegistrar ? 0 : 14 }}>
              {lista === null && <p className="suave">Carregando…</p>}
              {lista?.length === 0 && <p className="suave">Nenhuma ocorrência registrada.</p>}
              {lista?.map((o) => (
                <article key={o.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--borda)' }}>
                  <div className="suave pequeno">{fmt.data(o.registrado_em)} às {fmt.hora(o.registrado_em)}{o.registrado_por && ` · ${o.registrado_por}`}</div>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{o.texto}</div>
                </article>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
