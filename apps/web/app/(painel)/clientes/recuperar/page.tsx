'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, fmt } from '@/lib/api';
import { documentoCliente, mascara, NOME_TIPO_CLIENTE, soDigitos } from '@/lib/ui';
import { ExigeModulo, usePainel } from '@/components/Painel';
import { Confirmar } from '@/components/Confirmar';

export default function RecuperarCliente() {
  return <ExigeModulo modulo="M3"><Suspense><Recuperar /></Suspense></ExigeModulo>;
}

function Recuperar() {
  const { pode } = usePainel();
  const router = useRouter();
  const params = useSearchParams();
  const [documento, setDocumento] = useState(soDigitos(params.get('documento')));
  const [achados, setAchados] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [recuperar, setRecuperar] = useState<any>(null);

  async function buscar(doc = documento) {
    setErro(''); setAchados(null);
    if (doc.length !== 11 && doc.length !== 14) { setErro('Informe o CPF (11 dígitos) ou o CNPJ (14 dígitos).'); return; }
    setBuscando(true);
    try { setAchados(await api(`/clientes-excluidos?documento=${doc}`)); } catch (e: any) { setErro(e.message); } finally { setBuscando(false); }
  }
  useEffect(() => { if (documento.length === 11 || documento.length === 14) buscar(documento); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!pode('M3', 'excluir')) {
    return <div className="aviso">Somente quem tem permissão para excluir clientes pode recuperar uma exclusão. Peça a liberação à administradora.</div>;
  }

  // até 11 dígitos mostra como CPF, acima disso como CNPJ
  const mostrar = documento.length <= 11 ? mascara.cpf(documento) : mascara.cnpj(documento);

  return (
    <>
      <div className="topo">
        <div><div className="suave pequeno"><Link href="/clientes">Clientes</Link> / Recuperar exclusão</div>
          <h1>Recuperar cliente excluído</h1>
          <div className="suave">Localize pelo CNPJ (pessoa jurídica) ou pelo CPF (pessoa física).</div></div>
      </div>

      <form className="cartao filtros" style={{ maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); buscar(); }}>
        <label>CNPJ ou CPF
          <input autoFocus inputMode="numeric" placeholder="000.000.000-00 ou 00.000.000/0000-00" value={mostrar}
                 onChange={(e) => setDocumento(soDigitos(e.target.value).slice(0, 14))} />
        </label>
        <button className="btn primario" disabled={buscando} style={{ flex: '0 0 auto' }}>{buscando ? 'Buscando…' : 'Localizar'}</button>
      </form>

      {erro && <div className="aviso erro" style={{ maxWidth: 560, marginTop: 12 }}>{erro}</div>}
      {achados && achados.length === 0 && (
        <div className="aviso" style={{ maxWidth: 560, marginTop: 12 }}>Nenhum cliente excluído com este {documento.length === 11 ? 'CPF' : 'CNPJ'}.</div>
      )}
      {achados?.map((c) => (
        <section key={c.id} className="cartao" style={{ maxWidth: 560, marginTop: 12 }}>
          <h2 style={{ marginBottom: 4 }}>{c.nome_fantasia ?? c.razao_social}</h2>
          <div className="suave pequeno">{c.razao_social} · {documentoCliente(c)} · {NOME_TIPO_CLIENTE[c.tipo] ?? c.tipo}{c.cidade && ` · ${c.cidade}/${c.uf}`}</div>
          <p className="pequeno">Excluído em {fmt.dataHora(c.excluido_em)}{c.excluido_por && ` por ${c.excluido_por}`} · {c.eventos} evento(s) no histórico</p>
          <button className="btn primario" onClick={() => setRecuperar(c)}>Recuperar cliente</button>
        </section>
      ))}

      {recuperar && (
        <Confirmar titulo="Recuperar cliente?" rotulo="Sim, recuperar" onCancelar={() => setRecuperar(null)}
                   onConfirmar={async () => {
                     await api(`/clientes/${recuperar.id}/recuperar`, { method: 'POST', motivo: 'exclusão recuperada' });
                     router.push(`/clientes/${recuperar.id}`);
                   }}>
          <p><strong>{recuperar.nome_fantasia ?? recuperar.razao_social}</strong> ({documentoCliente(recuperar)}) volta a aparecer nas telas e nos relatórios,
            com o cadastro, os colaboradores e os eventos como estavam.</p>
        </Confirmar>
      )}
    </>
  );
}
