import Link from 'next/link';
import { MarcaCachet } from '@/components/Marca';
import { VERSAO_POLITICA } from '@/lib/legal';

/** Moldura das páginas de privacidade, cookies e termos */
export function PaginaLegal({ titulo, resumo, children }: { titulo: string; resumo?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="legal">
      <header className="legal-topo">
        <Link href="/" aria-label="Cachet, página inicial"><MarcaCachet tamanho={30} /></Link>
        <nav aria-label="Documentos">
          <Link href="/privacidade">Privacidade</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href="/termos">Termos de uso</Link>
          <Link href="/privacidade/solicitacao">Seus direitos</Link>
        </nav>
      </header>
      <main className="legal-corpo">
        <h1>{titulo}</h1>
        {resumo && <div className="legal-resumo">{resumo}</div>}
        {children}
      </main>
      <footer className="legal-rodape">Versão {VERSAO_POLITICA} · <Link href="/">Cachet</Link></footer>
    </div>
  );
}

/** Campo ainda não preenchido em lib/legal.ts: aparece destacado para não passar despercebido */
export function Dado({ valor, rotulo }: { valor: string; rotulo: string }) {
  return valor ? <>{valor}</> : <mark className="a-preencher">[{rotulo}: a preencher]</mark>;
}
