'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, salvarSessao, sessao } from '@/lib/api';
import { Rodape } from './Rodape';

type Acao = 'ver' | 'criar' | 'editar' | 'excluir' | 'aprovar' | 'ver_valores';
interface ItemMenu { modulo: string; nome: string; acoes: Acao[] }
interface Me {
  usuario: { id: string; nome: string; perfil: string; master?: boolean };
  empresa: { nome: string; slug: string };
  menu: ItemMenu[];
}

const Contexto = createContext<{ me: Me; pode: (modulo: string, acao?: Acao) => boolean } | null>(null);

export function usePainel() {
  const c = useContext(Contexto);
  if (!c) throw new Error('usePainel fora do <Painel>');
  return c;
}

/** Para onde cada módulo leva no menu. Módulos não liberados nem aparecem. */
const ROTAS: Record<string, { href: string; rotulo: string }> = {
  BI: { href: '/', rotulo: 'Painel' },
  M1: { href: '/profissionais', rotulo: 'Profissionais' },
  M2: { href: '/captacao', rotulo: 'Captação' },
  M3: { href: '/clientes', rotulo: 'Clientes' },
  M4: { href: '/eventos', rotulo: 'Eventos' },
  M5: { href: '/escala', rotulo: 'Escala' },
  M6: { href: '/campo', rotulo: 'Campo' },
  M7: { href: '/financeiro', rotulo: 'Financeiro' },
  M8: { href: '/relatorios', rotulo: 'Leads e relatórios' },
  M9: { href: '/gestao', rotulo: 'Gestão' },
};

export function Painel({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const router = useRouter();
  const caminho = usePathname();

  useEffect(() => {
    if (!sessao()) { router.replace('/login'); return; }
    api<Me>('/auth/me').then(setMe).catch(() => router.replace('/login'));
  }, [router]);

  if (!me) return <div className="conteudo suave">Carregando…</div>;

  const pode = (modulo: string, acao: Acao = 'ver') =>
    !!me.menu.find((m) => m.modulo === modulo)?.acoes?.includes(acao);

  const itens = me.menu
    .filter((m) => ROTAS[m.modulo])
    // Escala é acessada de dentro do evento; só mostra item próprio se não tiver M4
    .filter((m) => m.modulo !== 'M5' || !pode('M4'))
    .sort((a, b) => (a.modulo === 'BI' ? -1 : b.modulo === 'BI' ? 1 : 0));

  const ativo = (href: string) => (href === '/' ? caminho === '/' : caminho.startsWith(href));

  return (
    <Contexto.Provider value={{ me, pode }}>
      <div className="shell">
        <aside className="lateral">
          <div className="marca"><span>RD</span>{me.empresa.nome}</div>
          <nav className="menu">
            {itens.map((m) => (
              <Link key={m.modulo} href={ROTAS[m.modulo].href} className={ativo(ROTAS[m.modulo].href) ? 'ativo' : ''}>
                {ROTAS[m.modulo].rotulo}
                <span className="cod">{m.modulo}</span>
              </Link>
            ))}
            {me.usuario.perfil === 'admin' && (
              <Link href="/admin" className={ativo('/admin') ? 'ativo' : ''}>Módulos e acessos <span className="cod">ADM</span></Link>
            )}
            {me.usuario.master && (
              <Link href="/empresas" className={ativo('/empresas') ? 'ativo' : ''}>Empresas <span className="cod">MASTER</span></Link>
            )}
          </nav>
          <div className="rodape-menu" style={{ marginTop: 24, padding: '0 8px' }}>
            <div style={{ fontWeight: 600 }}>{me.usuario.nome}</div>
            <div className="suave pequeno">{me.usuario.perfil}</div>
            <button className="btn pequeno" style={{ marginTop: 10 }}
                    onClick={() => { salvarSessao(null); router.replace('/login'); }}>Sair</button>
          </div>
        </aside>
        <main className="conteudo">
          <div style={{ flex: 1 }}>{children}</div>
          <Rodape />
        </main>
      </div>
    </Contexto.Provider>
  );
}

/** Bloqueia a página inteira quando o módulo não está liberado ou o usuário não tem acesso. */
export function ExigeModulo({ modulo, acao = 'ver', children }: { modulo: string; acao?: Acao; children: React.ReactNode }) {
  const { pode } = usePainel();
  if (!pode(modulo, acao)) {
    return (
      <div className="cartao">
        <h2>Módulo não liberado</h2>
        <p className="suave">
          O módulo {modulo} não está liberado para a sua empresa ou para o seu perfil. Fale com a administradora.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
