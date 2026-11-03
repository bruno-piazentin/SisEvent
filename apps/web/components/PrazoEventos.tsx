'use client';
import { FAIXAS, Faixa, nomeFaixa, Prazos } from '@/lib/prazos';

/** Bolinha com a cor da faixa do evento (listas e cartões) */
export function CorPrazo({ faixa, prazos }: { faixa: Faixa | null; prazos: Prazos }) {
  if (!faixa) return null;
  return <span className="cor-prazo" style={{ background: prazos.cores[faixa] }} title={nomeFaixa(faixa, prazos)} />;
}

/**
 * Um card por faixa de prazo, com a quantidade de eventos. Clicar seleciona a faixa (clicar de novo limpa).
 * Nas faixas que ainda vão acontecer, mostra quantos eventos estão com vaga aberta.
 */
export function CardsPrazo({ eventos, prazos, selecionada, onSelecionar }: {
  eventos: { faixa: Faixa | null; vagas_abertas?: number }[];
  prazos: Prazos;
  selecionada: Faixa | null;
  onSelecionar: (f: Faixa | null) => void;
}) {
  return (
    <section className="cards-prazo" aria-label="Eventos por prazo">
      {FAIXAS.map((f) => {
        const doCard = eventos.filter((e) => e.faixa === f);
        const comVaga = ['hoje', 'proximo', 'medio', 'distante'].includes(f) ? doCard.filter((e) => (e.vagas_abertas ?? 0) > 0).length : 0;
        const ativo = selecionada === f;
        return (
          <button key={f} type="button" className={`cartao card-prazo ${ativo ? 'ativo' : ''}`} aria-pressed={ativo}
                  style={{ ['--cor' as any]: prazos.cores[f] }} onClick={() => onSelecionar(ativo ? null : f)}>
            <span className="rotulo"><span className="cor-prazo" />{nomeFaixa(f, prazos)}</span>
            <span className="valor">{doCard.length}</span>
            <span className="suave pequeno">
              {comVaga > 0 ? <span style={{ color: 'var(--alerta)', fontWeight: 600 }}>{comVaga} com vaga aberta</span>
                : (f === 'encerrado' || f === 'cancelado') ? `últimos ${prazos.historico_dias} dias` : ' '}
            </span>
          </button>
        );
      })}
    </section>
  );
}

/** Configuração das faixas no cadastro da empresa: os dois prazos, o histórico e a cor de cada faixa */
export function ConfigPrazos({ valor, onChange }: { valor: Prazos; onChange: (p: Prazos) => void }) {
  const numero = (k: 'ate_dias' | 'medio_ate_dias' | 'historico_dias', v: string) => onChange({ ...valor, [k]: Math.max(1, Math.round(Number(v) || 0)) });
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="linha">
        <label>1º prazo: eventos daqui até (dias)
          <input type="number" min={1} max={60} required value={valor.ate_dias} onChange={(e) => numero('ate_dias', e.target.value)} /></label>
        <label>2º prazo: eventos até (dias)
          <input type="number" min={valor.ate_dias + 1} max={365} required value={valor.medio_ate_dias} onChange={(e) => numero('medio_ate_dias', e.target.value)} /></label>
        <label>Encerrados e cancelados dos últimos (dias)
          <input type="number" min={1} max={365} required value={valor.historico_dias} onChange={(e) => numero('historico_dias', e.target.value)} /></label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px' }}>
        {FAIXAS.map((f) => (
          <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400 }}>
            <input type="color" value={valor.cores[f]} style={{ width: 36, height: 28, padding: 0, border: 0, background: 'none' }}
                   onChange={(e) => onChange({ ...valor, cores: { ...valor.cores, [f]: e.target.value } })} />
            {nomeFaixa(f, valor)}
          </label>
        ))}
      </div>
      <div className="suave pequeno">Os cards da tela inicial e do Campo usam estes prazos e cores. Eventos de hoje e em andamento ficam em "Hoje".</div>
    </div>
  );
}
