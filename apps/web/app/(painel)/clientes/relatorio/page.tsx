'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, fmt } from '@/lib/api';
import { baixarCsv, documentoCliente, enderecoCompleto, mascara, NOME_TIPO_CLIENTE } from '@/lib/ui';
import { ExigeModulo, usePainel, Voltar } from '@/components/Painel';
import { redesEmTexto } from '@/components/RedesSociais';

export default function RelatorioClientes() {
  return <ExigeModulo modulo="M3"><Relatorio /></ExigeModulo>;
}

function Relatorio() {
  const { me } = usePainel();
  const router = useRouter();
  const [clientes, setClientes] = useState<any[] | null>(null);
  const [selecionado, setSelecionado] = useState('');
  const [situacao, setSituacao] = useState<'todos' | 'ativos' | 'inativos'>('ativos');
  useEffect(() => { api('/clientes').then(setClientes); }, []);

  if (!clientes) return <div className="suave">Carregando…</div>;
  const lista = clientes.filter((c) => situacao === 'todos' || (situacao === 'ativos' ? c.ativo : !c.ativo));
  const totalEventos = lista.reduce((s, c) => s + Number(c.eventos), 0);
  const totalColab = lista.reduce((s, c) => s + Number(c.colaboradores), 0);

  function exportar() {
    baixarCsv(`clientes-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Nome fantasia', 'Razão social / nome', 'Pessoa', 'CNPJ / CPF', 'Tipo', 'Marcas', 'Telefone', 'E-mail', 'Redes sociais', 'Endereço', 'Cidade', 'UF', 'Prazo pagamento (dias)', 'Colaboradores', 'Eventos', 'Último evento', 'Situação'],
      ...lista.map((c) => [c.nome_fantasia, c.razao_social, c.pessoa === 'fisica' ? 'física' : 'jurídica',
        c.pessoa === 'fisica' ? mascara.cpf(c.cpf) : mascara.cnpj(c.cnpj), NOME_TIPO_CLIENTE[c.tipo] ?? c.tipo, c.marcas.join(', '), c.telefone, c.email, redesEmTexto(c.redes_sociais),
        enderecoCompleto(c), c.cidade, c.uf, c.prazo_pagamento_dias, c.colaboradores, c.eventos, c.ultimo_evento ? fmt.data(c.ultimo_evento) : '', c.ativo ? 'ativo' : 'inativo']),
    ]);
  }

  return (
    <div className="relatorio">
      <Voltar para="/clientes" />
      <div className="topo nao-imprimir">
        <div><div className="suave pequeno"><Link href="/clientes">Clientes</Link> / Relatórios</div><h1>Relatórios de clientes</h1></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportar}>Exportar planilha (CSV)</button>
          <button className="btn primario" onClick={() => window.print()}>Imprimir / salvar PDF</button>
        </div>
      </div>

      <div className="cartao nao-imprimir" style={{ marginBottom: 16 }}>
        <h2>Relatório detalhado de um cliente</h2>
        <form className="filtros" style={{ marginBottom: 0 }} onSubmit={(e) => { e.preventDefault(); if (selecionado) router.push(`/clientes/${selecionado}/relatorio`); }}>
          <label>Cliente
            <select value={selecionado} onChange={(e) => setSelecionado(e.target.value)} required>
              <option value="">Selecione…</option>
              {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome_fantasia ?? c.razao_social}</option>)}
            </select>
          </label>
          <button className="btn primario" disabled={!selecionado} style={{ flex: '0 0 auto' }}>Gerar relatório detalhado</button>
        </form>
      </div>

      <div className="cartao">
        <div className="cabecalho-relatorio">
          <div>
            <h1 style={{ margin: 0 }}>Relação de clientes</h1>
            <div className="suave pequeno">{me.empresa.nome} · emitido em {fmt.dataHora(new Date())} por {me.usuario.nome}</div>
          </div>
          <label className="nao-imprimir" style={{ minWidth: 160 }}>Situação
            <select value={situacao} onChange={(e) => setSituacao(e.target.value as any)}>
              <option value="ativos">Ativos</option><option value="inativos">Inativos</option><option value="todos">Todos</option>
            </select>
          </label>
        </div>

        <p className="pequeno"><strong>{lista.length}</strong> cliente(s) · <strong>{totalColab}</strong> colaborador(es) · <strong>{totalEventos}</strong> evento(s)</p>

        <div className="tabela">
          <table>
            <thead><tr><th>Cliente</th><th>CNPJ / CPF</th><th>Contato</th><th>Endereço</th><th>Colab.</th><th>Eventos</th><th>Último evento</th></tr></thead>
            <tbody>
              {lista.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`/clientes/${c.id}/relatorio`}><strong>{c.nome_fantasia ?? c.razao_social}</strong></Link>
                    <div className="suave">{c.razao_social} · {NOME_TIPO_CLIENTE[c.tipo] ?? c.tipo}{!c.ativo && ' · inativo'}</div>
                    {c.marcas.length > 0 && <div className="pequeno">Marcas: {c.marcas.join(', ')}</div>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{documentoCliente(c) || '—'}</td>
                  <td>{c.telefone ?? '—'}<div className="suave">{c.email}</div></td>
                  <td>{enderecoCompleto(c) || '—'}</td>
                  <td>{c.colaboradores}</td>
                  <td>{c.eventos}</td>
                  <td>{fmt.data(c.ultimo_evento)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
