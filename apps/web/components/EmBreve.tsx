'use client';
import { ExigeModulo } from './Painel';

/** Módulos das fases 2 e 3: a rota e a liberação já existem; a tela entra na fase correspondente. */
export function EmBreve({ modulo, titulo, itens }: { modulo: string; titulo: string; itens: string[] }) {
  return (
    <ExigeModulo modulo={modulo}>
      <div className="topo"><h1>{titulo}</h1></div>
      <div className="cartao">
        <p>Este módulo está liberado para a sua empresa e entra em desenvolvimento na próxima fase. Vai incluir:</p>
        <ul>{itens.map((i) => <li key={i}>{i}</li>)}</ul>
      </div>
    </ExigeModulo>
  );
}
