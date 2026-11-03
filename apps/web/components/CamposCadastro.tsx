'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { CampoRedesSociais } from './RedesSociais';
import { mascara, soDigitos } from '@/lib/ui';
import { usePainel } from './Painel';

/**
 * Campos de cadastro comuns a cliente e empresa (o mesmo esquema DadosCadastrais da API):
 * pessoa, identificação, contato, redes sociais e endereço com busca pelo CEP.
 */
export const CAMPOS_CADASTRO = ['pessoa', 'razao_social', 'nome_fantasia', 'cnpj', 'cpf', 'telefone', 'email', 'redes_sociais',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf'];

type Props = { c: any; set: (k: string, v: unknown) => void };

/** Monta o corpo para a API: texto vazio vira null e o documento que não vale para o tipo de pessoa sai */
export function corpoCadastro(c: any, campos: string[] = CAMPOS_CADASTRO) {
  const corpo: any = {};
  for (const k of campos) {
    const v = typeof c[k] === 'string' ? c[k].trim() : c[k];
    corpo[k] = v === '' || v === undefined ? null : v;
  }
  corpo.pessoa = corpo.pessoa ?? 'juridica';
  // pessoa física não tem CNPJ e jurídica não tem CPF
  corpo.cnpj = corpo.pessoa === 'juridica' ? soDigitos(corpo.cnpj) || null : null;
  corpo.cpf = corpo.pessoa === 'fisica' ? soDigitos(corpo.cpf) || null : null;
  corpo.cep = soDigitos(corpo.cep) || null;
  return corpo;
}

/** Pessoa jurídica/física, razão social, nome fantasia e CNPJ/CPF; `children` entra no fim da mesma linha */
export function CamposIdentificacao({ c, set, children }: Props & { children?: React.ReactNode }) {
  const fisica = c.pessoa === 'fisica';
  // CPF é dado pessoal: sem a permissão "Dados pessoais" o campo não aparece (e a API não o altera)
  const { pode } = usePainel();
  const verCpf = !c.ocultos?.includes('cpf') && pode('DP');
  return (
    <>
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
          ? verCpf && <label>CPF<input key="cpf" inputMode="numeric" placeholder="000.000.000-00" value={mascara.cpf(c.cpf)} onChange={(e) => set('cpf', soDigitos(e.target.value))} /></label>
          : <label>CNPJ<input key="cnpj" inputMode="numeric" placeholder="00.000.000/0000-00" value={mascara.cnpj(c.cnpj)} onChange={(e) => set('cnpj', soDigitos(e.target.value))} /></label>}
        {children}
      </div>
    </>
  );
}

/** Telefone e e-mail; `children` entra no fim da mesma linha */
export function CamposContato({ c, set, children }: Props & { children?: React.ReactNode }) {
  const fisica = c.pessoa === 'fisica';
  return (
    <div className="linha">
      <label>Telefone<input inputMode="tel" placeholder="(00) 00000-0000" value={mascara.telefone(c.telefone)} onChange={(e) => set('telefone', mascara.telefone(e.target.value))} /></label>
      <label>{fisica ? 'E-mail' : 'E-mail da empresa'}<input type="email" placeholder={fisica ? 'nome@email.com.br' : 'contato@empresa.com.br'} value={c.email ?? ''} onChange={(e) => set('email', e.target.value)} /></label>
      {children}
    </div>
  );
}

export function CamposRedes({ c, set }: Props) {
  return (
    <>
      <div className="suave pequeno" style={{ fontWeight: 600 }}>Redes sociais</div>
      <CampoRedesSociais valor={c.redes_sociais} onChange={(v) => set('redes_sociais', v)} />
    </>
  );
}

/** Endereço: ao completar o CEP, preenche logradouro, bairro, cidade e UF */
export function CamposEndereco({ c, set }: Props) {
  const [cepMsg, setCepMsg] = useState('');
  const [buscando, setBuscando] = useState(false);

  async function buscarCep(cep: string) {
    setBuscando(true); setCepMsg('');
    try {
      const r = await api(`/cep/${cep}`);
      set('logradouro', r.logradouro ?? ''); set('bairro', r.bairro ?? ''); set('cidade', r.cidade); set('uf', r.uf);
      setCepMsg('Endereço preenchido pelo CEP. Complete o número.');
    } catch (e: any) {
      setCepMsg(e.message);
    } finally { setBuscando(false); }
  }

  return (
    <>
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
    </>
  );
}
