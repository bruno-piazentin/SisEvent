'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const CHAVE = 'sisevent.aviso_cookies';

/**
 * Aviso de cookies. O Cachet só usa armazenamento necessário (sessão, tema, ponto sem internet),
 * então o aviso informa e não oferece opções: não há cookies opcionais para aceitar ou recusar.
 */
export function AvisoCookies() {
  const caminho = usePathname();
  const [mostrar, setMostrar] = useState(false);
  useEffect(() => {
    try { setMostrar(!localStorage.getItem(CHAVE)); } catch { /* sem armazenamento: não insiste */ }
  }, []);
  // a tela do QR fica aberta num tablet na entrada do evento: nada por cima dela
  if (!mostrar || caminho.startsWith('/qr')) return null;
  const fechar = () => { try { localStorage.setItem(CHAVE, new Date().toISOString()); } catch { /* */ } setMostrar(false); };
  return (
    <div className="aviso-cookies nao-imprimir" role="region" aria-label="Aviso de cookies">
      <p>Usamos apenas o armazenamento necessário para o sistema funcionar, sem cookies de publicidade ou rastreamento.{' '}
        <Link href="/cookies">Saiba mais</Link></p>
      <button className="btn primario" onClick={fechar}>Entendi</button>
    </div>
  );
}
