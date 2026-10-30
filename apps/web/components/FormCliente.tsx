'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';
import { CampoRedesSociais } from './RedesSociais';
import { mascara, NOME_TIPO_CLIENTE, soDigitos } from '@/lib/ui';

const CAMPOS = ['pessoa', 'razao_social', 'nome_fantasia', 'cnpj', 'cpf', 'tipo', 'prazo_pagamento_dias', 'telefone', 'email', 'redes_sociais',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

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
  const [cepMsg, setCepMsg] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const set = (k: string, v: unknown) => setC((x: any) => ({ ...x, [k]: v }));

  async function buscarCep(valor: string) {
    const cep = soDigitos(valor);
    if (cep.length !== 8) return;
    setBuscando(true); setCepMsg('');
    try {
      const r = await api(`/cep/${cep}`);
      setC((x: any) => ({ ...x, cep, logradouro: r.logradouro ?? '', bairro: r.bairro ?? '', cidade: r.cidade, uf: r.uf }));
      setCepMsg('Endereço preenchido pelo CEP. Complete o número.');
    } catch (e: any) {
      setCepMsg(e.message);
    } finally { setBuscando(false); }
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault(); setErro(''); setSalvando(true);
    const corpo: any = {};
    for (const k of CAMPOS) {
      const v = typeof c[k] === 'string' ? c[k].trim() : c[k];
      corpo[k] = v === '' || v === undefined ? null : v;
    }
    corpo.pessoa = corpo.pessoa ?? 'juridica';
    // pessoa física não tem CNPJ e jurídica não tem CPF
    corpo.cnpj = corpo.pessoa === 'juridica' ? soDigitos(corpo.cnpj) || null : null;
    corpo.cpf = corpo.pessoa === 'fisica' ? soDigitos(corpo.cpf) || null : null;
    corpo.cep = soDigitos(corpo.cep) || null;
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

      <div role="radiogroup" aria-label="Tipo de pessoa" style={{ display: 'flex', gap: 6 }}>
        {([['juridica', 'Pessoa jurídica (CNPJ)'], ['fisica', 'Pessoa física (CPF)']] as const).map(([v, rotulo]) => (
          <button key={v} type="button" role="radio" aria-checked={(c.pessoa ?? 'juridica') === v}
                  className={`btn pequeno ${(c.pessoa ?? 'juridica') === v ? 'primario' : ''}`} onClick={() => set('pessoa', v)}>{rotulo}</button>
        ))}
      </div>

      <div className="suave pequeno" style={{ fontWeight: 600 }}>{fisica ? 'Dados da pessoa' : 'Dados da empresa'}</div>
      <div className="linha">
        <label>{fisica ? 'Nome completo *' : 'Razão social *'}<input required value={c.razao_social ?? ''} onChange={(e) => set('razao_social', e.target.value)} /></label>
        <label>{fisica ? 'Como é chamado(a)' : 'Nome fantasia'}<input value={c.nome_fantasia ?? ''} onChange={(e) => set('nome_fantasia', e.target.value)} /></label>
        {fisica
          ? <label>CPF<input key="cpf" inputMode="numeric" placeholder="000.000.000-00" value={mascara.cpf(c.cpf)} onChange={(e) => set('cpf', soDigitos(e.target.value))} /></label>
          : <label>CNPJ<input key="cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" value={mascara.cnpj(c.cnpj)} onChange={(e) => set('cnpj', soDigitos(e.target.value))} /></label>}
        <label>Tipo<select value={c.tipo} onChange={(e) => set('tipo', e.target.value)}>
          {Object.entries(NOME_TIPO_CLIENTE).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
      </div>
      <CampoMarcas marcas={marcas} onChange={setMarcas} />
      <div className="linha">
        <label>Telefone<input inputMode="tel" placeholder="(00) 00000-0000" value={mascara.telefone(c.telefone)} onChange={(e) => set('telefone', mascara.telefone(e.target.value))} /></label>
        <label>{fisica ? 'E-mail' : 'E-mail da empresa'}<input type="email" placeholder={fisica ? 'nome@email.com.br' : 'contato@empresa.com.br'} value={c.email ?? ''} onChange={(e) => set('email', e.target.value)} /></label>
        <label>Prazo de pagamento (dias)<input type="number" min={0} max={180} value={c.prazo_pagamento_dias ?? 30} onChange={(e) => set('prazo_pagamento_dias', e.target.value)} /></label>
      </div>

      <div className="suave pequeno" style={{ fontWeight: 600 }}>Redes sociais</div>
      <CampoRedesSociais valor={c.redes_sociais} onChange={(v) => set('redes_sociais', v)} />

      <div className="suave pequeno" style={{ fontWeight: 600 }}>Endereço</div>
      <div className="linha">
        <label>CEP{buscando && <span className="suave"> · buscando…</span>}
          <input inputMode="numeric" placeholder="00000-000" value={mascara.cep(c.cep)}
                 onChange={(e) => { const v = soDigitos(e.target.value); set('cep', v); if (v.length === 8) buscarCep(v); }} />
        </label>
        <label>Logradouro<input value={c.logradouro ?? ''} onChange={(e) => set('logradouro', e.target.value)} /></label>
        <label>Número<input value={c.numero ?? ''} onChange={(e) => set('numero', e.target.value)} /></label>
        <label>Complemento<input value={c.complemento ?? ''} onChange={(e) => set('complemento', e.target.value)} /></label>
      </div>
      <div className="linha">
        <label>Bairro<input value={c.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} /></label>
        <label>Cidade<input value={c.cidade ?? ''} onChange={(e) => set('cidade', e.target.value)} /></label>
        <label>UF<input maxLength={2} value={c.uf ?? ''} onChange={(e) => set('uf', e.target.value.toUpperCase())} /></label>
      </div>
      {cepMsg && <div className="suave pequeno">{cepMsg}</div>}

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
