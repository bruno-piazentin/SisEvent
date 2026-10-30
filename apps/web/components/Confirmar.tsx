'use client';
import { useEffect, useRef, useState } from 'react';

/** Diálogo de confirmação para ações que mudam o cadastro (status, exclusão, recuperação) */
export function Confirmar({ titulo, children, rotulo, perigo, onConfirmar, onCancelar }: {
  titulo: string; children: React.ReactNode; rotulo: string; perigo?: boolean;
  onConfirmar: () => Promise<unknown>; onCancelar: () => void;
}) {
  const [executando, setExecutando] = useState(false);
  const [erro, setErro] = useState('');
  const cancelar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelar.current?.focus();   // o foco começa em "Cancelar": Enter não confirma por engano
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !executando && onCancelar();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [executando, onCancelar]);

  async function confirmar() {
    setExecutando(true); setErro('');
    try { await onConfirmar(); } catch (e: any) { setErro(e.message); setExecutando(false); }
  }

  return (
    <div role="presentation" onClick={() => !executando && onCancelar()}
         style={{ position: 'fixed', inset: 0, background: 'rgba(20,10,30,.45)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 50 }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="confirmar-titulo" className="cartao"
           onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460, width: '100%' }}>
        <h2 id="confirmar-titulo">{titulo}</h2>
        <div style={{ marginBottom: 16 }}>{children}</div>
        {erro && <div className="aviso erro" style={{ marginBottom: 12 }}>{erro}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button ref={cancelar} className="btn" disabled={executando} onClick={onCancelar}>Cancelar</button>
          <button className="btn primario" disabled={executando} onClick={confirmar}
                  style={perigo ? { background: 'var(--erro)', borderColor: 'var(--erro)' } : undefined}>
            {executando ? 'Aguarde…' : rotulo}
          </button>
        </div>
      </div>
    </div>
  );
}
