'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { sessao } from '@/lib/api';

/** No topo da página de apresentação: quem já tem sessão aberta vai direto para o sistema */
export function BotaoEntrar({ className }: { className?: string }) {
  const [logado, setLogado] = useState(false);
  useEffect(() => { setLogado(!!sessao()); }, []);
  return logado
    ? <Link href="/inicio" className={className}>Abrir o sistema</Link>
    : <Link href="/login" className={className}>Entrar</Link>;
}
