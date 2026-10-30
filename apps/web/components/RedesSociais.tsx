'use client';
import { REDES } from '@/lib/ui';

/** Campos de redes sociais (cliente e profissional). Guarda só as preenchidas. */
export function CampoRedesSociais({ valor, onChange }: { valor: Record<string, string> | null | undefined; onChange: (v: Record<string, string>) => void }) {
  const v = valor ?? {};
  return (
    <div className="linha">
      {REDES.map((r) => (
        <label key={r.chave}>{r.nome}
          <input placeholder={r.exemplo} value={v[r.chave] ?? ''}
                 onChange={(e) => onChange({ ...v, [r.chave]: e.target.value })} />
        </label>
      ))}
    </div>
  );
}

/** Redes preenchidas como links (ficha e relatório) */
export function LinksRedesSociais({ valor }: { valor: Record<string, string> | null | undefined }) {
  const preenchidas = REDES.filter((r) => valor?.[r.chave]);
  if (!preenchidas.length) return <>—</>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px' }}>
      {preenchidas.map((r) => (
        <a key={r.chave} href={r.url(valor![r.chave])} target="_blank" rel="noopener noreferrer">
          <span className="suave">{r.nome}:</span> {valor![r.chave]}
        </a>
      ))}
    </div>
  );
}

/** Texto simples para CSV: "Instagram: @x; Site: y" */
export const redesEmTexto = (valor: Record<string, string> | null | undefined) =>
  REDES.filter((r) => valor?.[r.chave]).map((r) => `${r.nome}: ${valor![r.chave]}`).join('; ');
