/**
 * Tema da tela: "auto" segue o aparelho; "claro" e "escuro" ficam fixos.
 * A escolha fica no navegador (vale para o painel, o login e o portal do profissional).
 */
export type Tema = 'auto' | 'claro' | 'escuro';
const CHAVE = 'sisevent.tema';

export function temaSalvo(): Tema {
  try {
    const t = localStorage.getItem(CHAVE);
    return t === 'claro' || t === 'escuro' ? t : 'auto';
  } catch { return 'auto'; }
}

export function aplicarTema(t: Tema) {
  if (t === 'auto') document.documentElement.removeAttribute('data-tema');
  else document.documentElement.setAttribute('data-tema', t);
  try { if (t === 'auto') localStorage.removeItem(CHAVE); else localStorage.setItem(CHAVE, t); } catch { /* sem armazenamento: vale só nesta tela */ }
}

/** Roda no <head> antes da página aparecer, para não piscar o tema errado */
export const SCRIPT_TEMA = `try{var t=localStorage.getItem('${CHAVE}');if(t==='claro'||t==='escuro')document.documentElement.setAttribute('data-tema',t)}catch(e){}`;
