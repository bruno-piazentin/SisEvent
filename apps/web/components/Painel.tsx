'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, sair, sessao } from '@/lib/api';
import { Rodape } from './Rodape';
import { LogoEmpresa, MarcaCachet } from './Marca';
import type { Prazos } from '@/lib/prazos';

type Acao = 'ver' | 'criar' | 'editar' | 'excluir' | 'aprovar' | 'ver_valores';
interface ItemMenu { modulo: string; nome: string; acoes: Acao[] }
interface Me {
  usuario: { id: string; nome: string; perfil: string; master?: boolean };
  empresa: { id: string; nome: string; slug: string; logo: string | null; prazos_eventos?: Prazos };
  menu: ItemMenu[];
}

const Contexto = createContext<{
  me: Me; pode: (modulo: string, acao?: Acao) => boolean; recarregar: () => Promise<void>;
  voltar: (destino: string) => void;
} | null>(null);

export function usePainel() {
  const c = useContext(Contexto);
  if (!c) throw new Error('usePainel fora do <Painel>');
  return c;
}

/** Para onde cada módulo leva no menu. Módulos não liberados nem aparecem. */
const ROTAS: Record<string, { href: string; rotulo: string }> = {
  BI: { href: '/inicio', rotulo: 'Painel' },
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
  // quantas telas já foram abertas nesta aba: com histórico do próprio sistema, "Voltar" volta para onde a pessoa estava
  const telas = useRef<string[]>([]);
  useEffect(() => { if (telas.current.at(-1) !== caminho) telas.current.push(caminho); }, [caminho]);
  const voltar = (destino: string) => {
    if (telas.current.length > 1) { telas.current.pop(); router.back(); } else router.push(destino);
  };

  const recarregar = () => api<Me>('/auth/me').then(setMe);
  useEffect(() => {
    if (!sessao()) { router.replace('/login'); return; }
    recarregar().catch(() => router.replace('/login'));
  }, [router]);

  if (!me) return <div className="conteudo suave">Carregando…</div>;

  const pode = (modulo: string, acao: Acao = 'ver') =>
    !!me.menu.find((m) => m.modulo === modulo)?.acoes?.includes(acao);

  const itens = me.menu
    .filter((m) => ROTAS[m.modulo])
    // Escala é acessada de dentro do evento; só mostra item próprio se não tiver M4
    .filter((m) => m.modulo !== 'M5' || !pode('M4'))
    .sort((a, b) => (a.modulo === 'BI' ? -1 : b.modulo === 'BI' ? 1 : 0));

  const ativo = (href: string) => caminho.startsWith(href);

  return (
    <Contexto.Provider value={{ me, pode, recarregar, voltar }}>
      <div className="shell">
        <aside className="lateral">
          <div className="marca"><LogoEmpresa nome={me.empresa.nome} logo={me.empresa.logo} />{me.empresa.nome}</div>
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
            {me.usuario.perfil === 'admin' && (
              <Link href="/lgpd" className={ativo('/lgpd') ? 'ativo' : ''}>Privacidade (LGPD) <span className="cod">LGPD</span></Link>
            )}
            {me.usuario.master && (
              <Link href="/empresas" className={ativo('/empresas') ? 'ativo' : ''}>Empresas <span className="cod">MASTER</span></Link>
            )}
            <Link href="/configuracoes" className={ativo('/configuracoes') ? 'ativo' : ''}>Configurações <span className="cod">CFG</span></Link>
          </nav>
          <div className="rodape-menu" style={{ marginTop: 24, padding: '0 8px' }}>
            <div style={{ fontWeight: 600 }}>{me.usuario.nome}</div>
            <div className="suave pequeno">{me.usuario.perfil}</div>
            <button className="btn pequeno" style={{ marginTop: 10 }}
                    onClick={async () => { await sair(); router.replace('/login'); }}>Sair</button>
            <div style={{ marginTop: 20, opacity: .8 }}><MarcaCachet tamanho={20} /></div>
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

/**
 * Botão "Voltar" das telas abertas a partir do menu (detalhe, cadastro, relatório).
 * Volta para a tela anterior; se a pessoa abriu direto pelo link, vai para `para`.
 */
export function Voltar({ para, rotulo = 'Voltar' }: { para: string; rotulo?: string }) {
  const { voltar } = usePainel();
  return <button type="button" className="btn pequeno voltar nao-imprimir" onClick={() => voltar(para)}>← {rotulo}</button>;
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
