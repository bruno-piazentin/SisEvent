'use client';
import { useState } from 'react';
import { apiPublica } from '@/lib/api';

/** Escala única de avaliação: a empresa avalia o profissional e o profissional avalia o evento */
export const NOTAS: { nota: number; rotulo: string }[] = [
  { nota: 5, rotulo: 'Excelente' },
  { nota: 4, rotulo: 'Muito bom' },
  { nota: 3, rotulo: 'Bom' },
  { nota: 2, rotulo: 'Regular' },
  { nota: 1, rotulo: 'Péssimo' },
];
export const rotuloNota = (n?: number | null) => NOTAS.find((x) => x.nota === n)?.rotulo ?? '';

/** Selo com a nota e o nome dela ("4 · Muito bom") */
export function SeloNota({ nota }: { nota?: number | null }) {
  if (!nota) return <span className="suave">—</span>;
  return <span className={`etiqueta ${nota >= 4 ? 'ok' : nota <= 2 ? 'erro' : 'alerta'}`}>{nota} · {rotuloNota(nota)}</span>;
}

/**
 * Nota de 1 a 5 com o comentário conforme a nota:
 * 5 sugere um elogio · 4, 3 e 2 abrem a observação opcional · 1 obriga a relatar o motivo.
 * `sobre` completa os textos: "o evento" ou "o profissional".
 */
export function FormAvaliacao({ inicial, sobre, grande, onEnviar, onCancelar }: {
  inicial?: { nota?: number | null; comentario?: string | null };
  sobre: string;
  grande?: boolean;
  onEnviar: (nota: number, comentario: string) => Promise<void>;
  onCancelar?: () => void;
}) {
  const [nota, setNota] = useState<number | null>(inicial?.nota ?? null);
  const [comentario, setComentario] = useState(inicial?.comentario ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const obrigatorio = nota === 1;
  const curto = obrigatorio && comentario.trim().length < 10;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!nota || curto) return;
    setErro(''); setEnviando(true);
    try { await onEnviar(nota, comentario.trim()); } catch (x: any) { setErro(x.message); } finally { setEnviando(false); }
  }

  return (
    <form className="form-avaliacao" onSubmit={enviar}>
      <div role="radiogroup" aria-label={`Nota para ${sobre}`} className={`notas ${grande ? 'grande' : ''}`}>
        {NOTAS.map((n) => (
          <button key={n.nota} type="button" role="radio" aria-checked={nota === n.nota}
                  className={`nota n${n.nota} ${nota === n.nota ? 'ativa' : ''}`} onClick={() => setNota(n.nota)}>
            <strong>{n.nota}</strong><span>{n.rotulo}</span>
          </button>
        ))}
      </div>
      {nota && (
        <label>
          {nota === 5 ? `Quer deixar um elogio sobre ${sobre}? (opcional)`
            : nota === 1 ? `Conte o que aconteceu com ${sobre} para dar essa nota (obrigatório)`
            : 'Observação (opcional)'}
          <textarea rows={3} value={comentario} required={obrigatorio} minLength={obrigatorio ? 10 : undefined} maxLength={2000}
                    placeholder={nota === 5 ? 'Ex.: pontual, atencioso com o público…' : nota === 1 ? 'Descreva o motivo (pelo menos 10 letras)' : ''}
                    onChange={(e) => setComentario(e.target.value)} />
        </label>
      )}
      {curto && comentario.length > 0 && <div className="suave pequeno">Escreva pelo menos 10 letras.</div>}
      {erro && <div className="aviso erro">{erro}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className={`btn primario ${grande ? 'grande' : ''}`} disabled={!nota || curto || enviando}>
          {enviando ? 'Enviando…' : 'Enviar avaliação'}
        </button>
        {onCancelar && <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>}
      </div>
    </form>
  );
}

/** O profissional avalia o evento depois do check-out (obrigatório: fica pendente até responder) */
export function AvaliarEvento({ token, eventoId, evento, onAvaliado }: {
  token: string; eventoId: string; evento?: string; onAvaliado: (mensagem: string) => void;
}) {
  return (
    <div className="avaliar-evento">
      <div style={{ fontWeight: 700 }}>Como foi {evento ? <>o evento <span style={{ color: 'var(--primaria)' }}>{evento}</span></> : 'este evento'}?</div>
      <div className="suave pequeno" style={{ marginBottom: 8 }}>A sua avaliação é obrigatória e ajuda a melhorar os próximos eventos.</div>
      <FormAvaliacao sobre="o evento" grande onEnviar={async (nota, comentario) => {
        const r = await apiPublica<{ ok: boolean; mensagem: string }>(`/p/${token}/avaliar-evento`, { evento_id: eventoId, nota, comentario });
        if (!r.ok) throw new Error(r.mensagem);
        onAvaliado(r.mensagem);
      }} />
    </div>
  );
}
