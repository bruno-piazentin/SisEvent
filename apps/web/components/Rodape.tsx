/** Links legais e crédito de desenvolvimento, no rodapé do painel e do login (não sai na impressão) */
export function Rodape() {
  return (
    <footer className="rodape nao-imprimir">
      <a href="/privacidade">Privacidade</a> · <a href="/termos">Termos de uso</a> · Desenvolvido by{' '}
      <a href="https://www.unnacomunicacao.com.br" target="_blank" rel="noopener noreferrer">UNNA</a>
    </footer>
  );
}
