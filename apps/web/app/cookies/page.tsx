import type { Metadata } from 'next';
import Link from 'next/link';
import { PaginaLegal } from '@/components/legal/PaginaLegal';

export const metadata: Metadata = { title: 'Política de Cookies · Cachet', description: 'Cookies e armazenamento no navegador usados pelo Cachet.' };

/** Tudo o que o Cachet grava no navegador (conferido no código: lib/api, lib/tema, lib/token-profissional, lib/fila-offline, sw.js) */
const ITENS: [string, string, string, string][] = [
  ['sisevent.sessao', 'Armazenamento local', 'Mantém o usuário da empresa conectado (token da sessão).', 'Até sair do sistema ou a sessão vencer (12 horas).'],
  ['sisevent_empresa', 'Armazenamento local', 'Lembra o código da empresa no login.', 'Até ser apagado no navegador.'],
  ['sisevent.tema', 'Armazenamento local', 'Guarda a escolha de tema claro ou escuro.', 'Até mudar para "Automático" ou apagar.'],
  ['sisevent.token_profissional', 'Armazenamento local', 'Guarda o link pessoal do profissional para o check-in pelo QR.', 'Até ser apagado no navegador.'],
  ['sisevent.fila_ponto', 'Armazenamento local', 'Guarda registros de entrada e saída feitos sem internet até o envio.', 'Até o envio do registro.'],
  ['sisevent.aviso_cookies', 'Armazenamento local', 'Lembra que o aviso de cookies já foi visto.', 'Até ser apagado no navegador.'],
  ['sisevent-v4', 'Cache do aplicativo', 'Guarda as telas e os arquivos do sistema para abrir mais rápido e funcionar com sinal fraco.', 'Até a próxima versão do sistema.'],
];

export default function Cookies() {
  return (
    <PaginaLegal titulo="Política de Cookies"
      resumo={<>O Cachet <b>não usa cookies de publicidade, de rastreamento nem ferramentas de análise de terceiros</b>.
        Só grava no navegador o que é necessário para o sistema funcionar, por isso não pede consentimento para cookies opcionais: eles não existem.</>}>
      <h2>O que gravamos no seu navegador</h2>
      <p>Em vez de cookies, o Cachet usa o armazenamento local do navegador e o cache do aplicativo. Esses dados ficam só no seu aparelho e não são lidos por outros sites.</p>
      <div className="tabela">
        <table className="legal-tabela">
          <thead><tr><th>Nome</th><th>Tipo</th><th>Para que serve</th><th>Duração</th></tr></thead>
          <tbody>{ITENS.map(([n, t, p, d]) => <tr key={n}><td><code>{n}</code></td><td>{t}</td><td>{p}</td><td>{d}</td></tr>)}</tbody>
        </table>
      </div>
      <p>Todos são <b>estritamente necessários</b>: sem eles não é possível manter o login, guardar o tema escolhido ou registrar o ponto sem internet.
        A base legal é o legítimo interesse e a execução do serviço pedido por você (art. 7º, V e IX, da LGPD).</p>

      <h2>Links para outros sites</h2>
      <p>O botão de WhatsApp abre o aplicativo ou o site do WhatsApp, que tem a própria política de privacidade e de cookies.</p>

      <h2>Como apagar</h2>
      <p>Você pode apagar esses dados a qualquer momento nas configurações do navegador, em “dados de sites” ou “armazenamento”.
        Se apagar, será preciso entrar de novo no sistema, e registros de ponto ainda não enviados serão perdidos.</p>

      <h2>Mudanças</h2>
      <p>Se um dia o Cachet passar a usar cookies opcionais, como de análise de uso, eles só serão ativados depois do seu consentimento, com opção de recusar.
        Dúvidas: veja a <Link href="/privacidade">Política de Privacidade</Link>.</p>
    </PaginaLegal>
  );
}
