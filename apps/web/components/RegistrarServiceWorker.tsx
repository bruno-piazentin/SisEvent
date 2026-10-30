'use client';
import { useEffect } from 'react';

/** PWA: permite abrir a área do profissional sem internet e "adicionar à tela inicial". */
export function RegistrarServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return null;
}
