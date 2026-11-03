'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, fmt } from '@/lib/api';
import { baixarCsv, COR_STATUS, enderecoCompleto, mascara, NOME_TIPO_CLIENTE, nomeColaborador } from '@/lib/ui';
import { ExigeModulo, usePainel, Voltar } from '@/components/Painel';
import { redesEmTexto } from '@/components/RedesSociais';

const situacao = (s: string) => (s === 'fechado' ? 'Fechado / finalizado' : s === 'cancelado' ? 'Cancelado' : 'Em aberto');

export default function RelatorioCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ExigeModulo modulo="M3"><Relatorio id={id} /></ExigeModulo>;
}

function Relatorio({ id }: { id: string }) {
  const { me } = usePainel();
  const [c, setC] = useState<any>(null);
  const [erro, setErro] = useState('');
  useEffect(() => { api(`/clientes/${id}`).then(setC).catch((e) => setErro(e.message)); }, [id]);

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!c) return <div className="suave">Carregando…</div>;

  const nome = c.nome_fantasia ?? c.razao_social;
  const eventos: any[] = c.eventos;
  const contar = (f: (e: any) => boolean) => eventos.filter(f).length;
  const abertos = contar((e) => !['fechado', 'cancelado'].includes(e.status));
  const fechados = contar((e) => e.status === 'fechado');
  const cancelados = contar((e) => e.status === 'cancelado');

  function exportar() {
    const arq = `cliente-${nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-')}.csv`;
    baixarCsv(arq, [
      ['Cliente', nome], ['Razão social', c.razao_social], ['Pessoa', c.pessoa === 'fisica' ? 'física' : 'jurídica'], [c.pessoa === 'fisica' ? 'CPF' : 'CNPJ', c.pessoa === 'fisica' ? mascara.cpf(c.cpf) : mascara.cnpj(c.cnpj)],
      ['Status', c.ativo ? 'Ativo' : 'Inativo'], ['Marcas', c.marcas.join(', ')],['Telefone', c.telefone], ['E-mail', c.email], ['Redes sociais', redesEmTexto(c.redes_sociais)],
      ['Endereço', enderecoCompleto(c)], [],
      ['COLABORADORES'], ['Nome', 'Sobrenome', 'Apelido', 'Cargo', 'E-mail', 'Telefone', 'Principal'],
      ...c.contatos.map((ct: any) => [ct.nome, ct.sobrenome, ct.apelido, ct.cargo, ct.email, ct.telefone, ct.principal ? 'sim' : '']), [],
      ['EVENTOS'], ['Evento', 'Início', 'Fim', 'Praça', 'Local', 'Status', 'Situação', 'Confirmados', 'Vagas'],
      ...eventos.map((e) => [e.nome, fmt.dataHora(e.inicio), fmt.dataHora(e.fim), e.praca, e.local_nome, e.status.replace('_', ' '), situacao(e.status), e.confirmados, e.vagas]),
    ]);
  }

  return (
    <div className="relatorio">
      <Voltar para={`/clientes/${id}`} />
      <div className="topo nao-imprimir">
        <div><div className="suave pequeno"><Link href="/clientes">Clientes</Link> / <Link href={`/clientes/${id}`}>{nome}</Link> / Relatório</div>
          <h1>Relatório do cliente</h1></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn" href="/clientes/relatorio">Todos os clientes</Link>
          <button className="btn" onClick={exportar}>Exportar planilha (CSV)</button>
          <button className="btn primario" onClick={() => window.print()}>Imprimir / salvar PDF</button>
        </div>
      </div>

      <div className="cartao">
        <div className="cabecalho-relatorio">
          <div>
            <h1 style={{ margin: 0 }}>{nome}</h1>
            <div className="suave pequeno">{c.razao_social} · {c.pessoa === 'fisica' ? 'Pessoa física' : 'Pessoa jurídica'} · {NOME_TIPO_CLIENTE[c.tipo] ?? c.tipo}{!c.ativo && ' · inativo'}</div>
          </div>
          <div className="suave pequeno" style={{ textAlign: 'right' }}>{me.empresa.nome}<br />emitido em {fmt.dataHora(new Date())}</div>
        </div>

        <section>
          <h2>Dados cadastrais</h2>
          <table>
            <tbody>
              <tr><td className="suave" style={{ width: 160 }}>{c.pessoa === 'fisica' ? 'CPF' : 'CNPJ'}</td>
                <td>{(c.pessoa === 'fisica' ? (c.cpf && mascara.cpf(c.cpf)) : (c.cnpj && mascara.cnpj(c.cnpj))) || '—'}</td></tr>
              <tr><td className="suave">Status</td><td>{c.ativo ? 'Ativo' : 'Inativo'}</td></tr>
              <tr><td className="suave">Marcas</td><td>{c.marcas.length ? c.marcas.join(', ') : '—'}</td></tr>
              <tr><td className="suave">Telefone</td><td>{c.telefone ?? '—'}</td></tr>
              <tr><td className="suave">E-mail</td><td>{c.email ?? '—'}</td></tr>
              <tr><td className="suave">Redes sociais</td><td>{redesEmTexto(c.redes_sociais) || '—'}</td></tr>
              <tr><td className="suave">Endereço</td><td>{enderecoCompleto(c) || '—'}</td></tr>
              {c.agencia && <tr><td className="suave">Agência</td><td>{c.agencia}</td></tr>}
              <tr><td className="suave">Prazo de pagamento</td><td>{c.prazo_pagamento_dias} dias</td></tr>
              <tr><td className="suave">Cliente desde</td><td>{fmt.data(c.criado_em)}</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>Colaboradores ({c.contatos.length})</h2>
          {c.contatos.length === 0 ? <p className="suave">Nenhum colaborador vinculado.</p> : (
            <table>
              <thead><tr><th>Nome</th><th>Apelido</th><th>Cargo</th><th>E-mail</th><th>Telefone</th></tr></thead>
              <tbody>
                {c.contatos.map((ct: any) => (
                  <tr key={ct.id}>
                    <td><strong>{nomeColaborador(ct)}</strong>{ct.principal && <span className="etiqueta" style={{ marginLeft: 6 }}>principal</span>}</td>
                    <td>{ct.apelido ?? '—'}</td><td>{ct.cargo ?? '—'}</td><td>{ct.email ?? '—'}</td><td style={{ whiteSpace: 'nowrap' }}>{ct.telefone ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section>
          <h2>Eventos ({eventos.length})</h2>
          <p className="pequeno">Em aberto: <strong>{abertos}</strong> · Fechados / finalizados: <strong>{fechados}</strong> · Cancelados: <strong>{cancelados}</strong>
            {eventos.length > 0 && <> · Período: {fmt.data(eventos[eventos.length - 1].inicio)} a {fmt.data(eventos[0].inicio)}</>}</p>
          {eventos.length > 0 && (
            <table>
              <thead><tr><th>Evento</th><th>Data</th><th>Praça / local</th><th>Escala</th><th>Status</th></tr></thead>
              <tbody>
                {eventos.map((e) => (
                  <tr key={e.id}>
                    <td><strong>{e.nome}</strong>{e.marca && <div className="suave">{e.marca}</div>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt.dataHora(e.inicio)}<div className="suave">até {fmt.dataHora(e.fim)}</div></td>
                    <td>{e.praca}{e.local_nome && <div className="suave">{e.local_nome}</div>}</td>
                    <td>{e.confirmados}/{e.vagas}</td>
                    <td><span className={`etiqueta ${COR_STATUS[e.status]}`}>{e.status.replace('_', ' ')}</span><div className="suave">{situacao(e.status)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
