'use client';
import { useEffect, useState } from 'react';
import { usePainel } from '@/components/Painel';
import { aplicarTema, Tema, temaSalvo } from '@/lib/tema';

/** Preferências de quem está usando, neste aparelho. Aberta a todos os usuários. */
export default function Configuracoes() {
  const { me } = usePainel();
  const [tema, setTema] = useState<Tema>('auto');
  useEffect(() => setTema(temaSalvo()), []);

  const opcoes: { valor: Tema; nome: string; descricao: string }[] = [
    { valor: 'auto', nome: 'Automático', descricao: 'Segue o aparelho: claro de dia, escuro se o celular ou computador estiver no modo escuro.' },
    { valor: 'claro', nome: 'Claro', descricao: 'Fundo claro e menu lateral no roxo da marca.' },
    { valor: 'escuro', nome: 'Escuro', descricao: 'Fundo escuro e menu lateral claro. Cansa menos a vista à noite.' },
  ];

  return (
    <>
      <div className="topo">
        <div>
          <h1>Configurações</h1>
          <div className="suave">{me.usuario.nome} · {me.empresa.nome}</div>
        </div>
      </div>

      <section className="cartao">
        <h2>Tema</h2>
        <div className="opcoes-tema" role="radiogroup" aria-label="Tema da tela">
          {opcoes.map((o) => (
            <button key={o.valor} type="button" role="radio" aria-checked={tema === o.valor}
                    className={`opcao-tema ${tema === o.valor ? 'ativo' : ''}`}
                    onClick={() => { aplicarTema(o.valor); setTema(o.valor); }}>
              <span className={`amostra-tema ${o.valor}`} aria-hidden="true"><i /><b /></span>
              <strong>{o.nome}</strong>
              <span className="suave pequeno">{o.descricao}</span>
            </button>
          ))}
        </div>
        <p className="suave pequeno" style={{ marginBottom: 0 }}>A escolha fica guardada neste navegador e vale também na tela de login e no portal do profissional. Relatórios impressos saem sempre no tema claro.</p>
      </section>
    </>
  );
}
