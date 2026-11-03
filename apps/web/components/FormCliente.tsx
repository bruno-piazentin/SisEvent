'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { CAMPOS_CADASTRO, CamposContato, CamposEndereco, CamposIdentificacao, CamposRedes, corpoCadastro } from './CamposCadastro';
import { NOME_TIPO_CLIENTE, soDigitos } from '@/lib/ui';

const CAMPOS = [...CAMPOS_CADASTRO, 'tipo', 'prazo_pagamento_dias'];

const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().toLowerCase();

/** Marcas que a empresa representa / vende. Sugere as já cadastradas; uma marca nova entra no catálogo ao salvar. */
function CampoMarcas({ marcas, onChange }: { marcas: string[]; onChange: (m: string[]) => void }) {
  const [texto, setTexto] = useState('');
  const [catalogo, setCatalogo] = useState<{ nome: string; clientes: number }[]>([]);
  useEffect(() => { api('/marcas').then(setCatalogo).catch(() => undefined); }, []);

  function adicionar(bruto: string) {
    const nomes = bruto.split(/[,;]/).map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const novas = [...marcas];
    for (const n of nomes) {
      // aproveita a grafia do catálogo quando a marca já existe ("coca cola" vira "Coca-Cola")
      const existente = catalogo.find((m) => chave(m.nome) === chave(n))?.nome ?? n;
      if (!novas.some((m) => chave(m) === chave(existente))) novas.push(existente);
    }
    onChange(novas);
    setTexto('');
  }

  const sugestoes = catalogo.filter((m) => !marcas.some((x) => chave(x) === chave(m.nome)));
  const existe = (n: string) => catalogo.some((m) => chave(m.nome) === chave(n));

  return (
    // div e não label: dentro de um label, o clique dispararia o primeiro botão "×"
    <div style={{ display: 'grid', gap: 4, fontSize: '.85rem', fontWeight: 600, color: 'var(--suave)' }}>
      <span id="rotulo-marcas">Marcas que representa / vende</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', border: '1px solid var(--borda)', borderRadius: 8, padding: 6, background: 'var(--painel)' }}>
        {marcas.map((m) => (
          <span key={m} className={`etiqueta ${existe(m) ? '' : 'ok'}`} title={existe(m) ? 'Marca já cadastrada' : 'Marca nova: entra no catálogo ao salvar'}>
            {m}{!existe(m) && ' (nova)'}{' '}
            <button type="button" aria-label={`Remover ${m}`} onClick={() => onChange(marcas.filter((x) => x !== m))}
                    style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, font: 'inherit' }}>×</button>
          </span>
        ))}
        <input list="catalogo-marcas" aria-labelledby="rotulo-marcas" value={texto} placeholder={marcas.length ? 'Adicionar outra marca…' : 'Digite a marca e tecle Enter'}
               style={{ border: 0, outline: 0, flex: '1 1 180px', width: 'auto', padding: 4 }}
               onChange={(e) => {
                 const v = e.target.value;
                 // escolher uma sugestão da lista já adiciona
                 if (catalogo.some((m) => m.nome === v)) adicionar(v); else setTexto(v);
               }}
               onKeyDown={(e) => {
                 if ((e.key === 'Enter' || e.key === ',') && texto.trim()) { e.preventDefault(); adicionar(texto); }
                 if (e.key === 'Backspace' && !texto && marcas.length) onChange(marcas.slice(0, -1));
               }}
               onBlur={() => texto.trim() && adicionar(texto)} />
        <datalist id="catalogo-marcas">
          {sugestoes.map((m) => <option key={m.nome} value={m.nome}>{m.clientes ? `${m.clientes} cliente(s)` : ''}</option>)}
        </datalist>
      </div>
      <span className="suave pequeno" style={{ fontWeight: 400 }}>Separe por vírgula ou tecle Enter. As marcas ficam salvas para a busca por marca.</span>
    </div>
  );
}

/** Cadastro do cliente (novo ou edição), com busca de endereço pelo CEP */
export function FormCliente({ inicial, onSalvo, onCancelar }: { inicial?: any; onSalvo: (id: string) => void; onCancelar: () => void }) {
  const [c, setC] = useState<any>({ tipo: 'outro', prazo_pagamento_dias: 30, ...inicial });
  const [marcas, setMarcas] = useState<string[]>(inicial?.marcas ?? []);
  const [erro, setErro] = useState('');
  const [excluido, setExcluido] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const set = (k: string, v: unknown) => setC((x: any) => ({ ...x, [k]: v }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const corpo = corpoCadastro(c, CAMPOS);
    corpo.prazo_pagamento_dias = Number(corpo.prazo_pagamento_dias ?? 30);
    corpo.tipo = corpo.tipo ?? 'outro';
    corpo.marcas = marcas;
    try {
      const r = inicial?.id
        ? await api(`/clientes/${inicial.id}`, { method: 'PATCH', json: corpo })
        : await api('/clientes', { method: 'POST', json: corpo });
      onSalvo(r.id);
    } catch (e: any) {
      setErro(e.codigo === 'cliente_excluido' ? e.message : e.dados?.campos?.[0]?.mensagem ?? e.message);
      setExcluido(e.codigo === 'cliente_excluido');
    } finally { setSalvando(false); }
  }

  const fisica = c.pessoa === 'fisica';

  return (
    <form className="cartao form" style={{ marginBottom: 16 }} onSubmit={salvar}>
      <h2 style={{ margin: 0 }}>{inicial?.id ? 'Editar cliente' : 'Novo cliente'}</h2>

      <CamposIdentificacao c={c} set={set}>
        <label>Tipo<select value={c.tipo} onChange={(e) => set('tipo', e.target.value)}>
          {Object.entries(NOME_TIPO_CLIENTE).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
      </CamposIdentificacao>
      <CampoMarcas marcas={marcas} onChange={setMarcas} />
      <CamposContato c={c} set={set}>
        <label>Prazo de pagamento (dias)<input type="number" min={0} max={180} value={c.prazo_pagamento_dias ?? 30} onChange={(e) => set('prazo_pagamento_dias', e.target.value)} /></label>
      </CamposContato>
      <CamposRedes c={c} set={set} />
      <CamposEndereco c={c} set={set} />

      {erro && (
        <div className="aviso erro">{erro}
          {excluido && <> <Link href={`/clientes/recuperar?documento=${soDigitos(fisica ? c.cpf : c.cnpj)}`}><strong>Recuperar exclusão</strong></Link></>}
        </div>
      )}
      {!inicial?.id && <div className="suave pequeno">Depois de salvar, você vincula os colaboradores (agentes) na ficha do cliente.</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primario" disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</button>
        <button type="button" className="btn" onClick={onCancelar}>Cancelar</button>
      </div>
    </form>
  );
}
