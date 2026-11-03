'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, fmt } from '@/lib/api';
import { COR_STATUS, documentoCliente, enderecoCompleto, mascara, NOME_TIPO_CLIENTE } from '@/lib/ui';
import { ExigeModulo, usePainel, Voltar } from '@/components/Painel';
import { Confirmar } from '@/components/Confirmar';
import { Ocorrencias } from '@/components/Ocorrencias';
import { LinksRedesSociais } from '@/components/RedesSociais';
import { FormCliente } from '@/components/FormCliente';
import { Colaboradores } from '@/components/Colaboradores';

type Grupo = 'aberto' | 'fechado' | 'cancelado';
const grupo = (status: string): Grupo => (status === 'fechado' ? 'fechado' : status === 'cancelado' ? 'cancelado' : 'aberto');
const NOME_GRUPO: Record<Grupo, string> = { aberto: 'Em aberto', fechado: 'Fechado / finalizado', cancelado: 'Cancelado' };
const COR_GRUPO: Record<Grupo, string> = { aberto: 'alerta', fechado: 'ok', cancelado: 'erro' };
const NOME_FATURA: Record<string, string> = { a_emitir: 'a emitir', emitida: 'emitida', recebida: 'recebida', cancelada: 'cancelada' };

export default function DetalheCliente({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ExigeModulo modulo="M3"><Cliente id={id} /></ExigeModulo>;
}

function Cliente({ id }: { id: string }) {
  const { pode } = usePainel();
  const [c, setC] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [editando, setEditando] = useState(false);
  const [confirmar, setConfirmar] = useState<'status' | 'excluir' | null>(null);
  const router = useRouter();
  const [filtro, setFiltro] = useState<Grupo | ''>('');
  const [selecionado, setSelecionado] = useState<string | null>(null);

  const carregar = () => api(`/clientes/${id}`)
    .then((r) => { setC(r); setSelecionado((s) => s ?? r.eventos[0]?.id ?? null); })
    .catch((e) => setErro(e.message));
  useEffect(() => { carregar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro && !c) return <div className="aviso erro">{erro}</div>;
  if (!c) return <div className="suave">Carregando…</div>;

  const eventos: any[] = c.eventos;
  const qtd = (g: Grupo) => eventos.filter((e) => grupo(e.status) === g).length;
  const lista = filtro ? eventos.filter((e) => grupo(e.status) === filtro) : eventos;

  return (
    <>
      <Voltar para="/clientes" />
      <div className="topo">
        <div>
          <div className="suave pequeno"><Link href="/clientes">Clientes</Link> / {c.nome_fantasia ?? c.razao_social}</div>
          <h1>{c.nome_fantasia ?? c.razao_social}{' '}
            <span className={`etiqueta ${c.ativo ? 'ok' : 'neutra'}`} style={{ verticalAlign: 'middle' }}>{c.ativo ? 'Ativo' : 'Inativo'}</span></h1>
          <div className="suave">{c.razao_social} · {c.pessoa === 'fisica' ? 'Pessoa física' : 'Pessoa jurídica'} · {NOME_TIPO_CLIENTE[c.tipo] ?? c.tipo}</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Ocorrencias caminho={`/clientes/${id}`} nome={c.nome_fantasia ?? c.razao_social} podeRegistrar={pode('M3', 'editar')} />
          <Link className="btn" href={`/clientes/${id}/relatorio`}>Relatório do cliente</Link>
          {pode('M3', 'editar') && !editando && <button className="btn" onClick={() => setEditando(true)}>Editar cadastro</button>}
          {pode('M3', 'editar') && !editando && (
            <button className="btn" onClick={() => setConfirmar('status')}>{c.ativo ? 'Inativar' : 'Reativar'}</button>
          )}
          {pode('M3', 'excluir') && !editando && <button className="btn perigo" onClick={() => setConfirmar('excluir')}>Excluir</button>}
        </div>
      </div>

      {confirmar === 'status' && (
        <Confirmar titulo={c.ativo ? 'Inativar cliente?' : 'Reativar cliente?'} rotulo={c.ativo ? 'Sim, inativar' : 'Sim, reativar'}
                   onCancelar={() => setConfirmar(null)}
                   onConfirmar={async () => {
                     await api(`/clientes/${id}`, { method: 'PATCH', json: { ativo: !c.ativo }, motivo: c.ativo ? 'cliente inativado' : 'cliente reativado' });
                     setConfirmar(null); await carregar();
                   }}>
          <p>O status de <strong>{c.nome_fantasia ?? c.razao_social}</strong> vai mudar de <strong>{c.ativo ? 'Ativo' : 'Inativo'}</strong> para <strong>{c.ativo ? 'Inativo' : 'Ativo'}</strong>.</p>
          <p className="suave pequeno">{c.ativo
            ? 'O cliente continua visível na lista e nos relatórios, marcado como inativo. Os eventos e o histórico não mudam.'
            : 'O cliente volta a constar como ativo.'}</p>
        </Confirmar>
      )}
      {confirmar === 'excluir' && (
        <Confirmar titulo="Excluir cliente?" rotulo="Sim, excluir" perigo onCancelar={() => setConfirmar(null)}
                   onConfirmar={async () => {
                     await api(`/clientes/${id}`, { method: 'DELETE', motivo: 'cliente excluído' });
                     router.push('/clientes');
                   }}>
          <p><strong>{c.nome_fantasia ?? c.razao_social}</strong>{documentoCliente(c) && ` (${documentoCliente(c)})`} deixará de aparecer nas telas e nos relatórios.</p>
          <p className="suave pequeno">O cadastro, os colaboradores e os {eventos.length} evento(s) continuam guardados na base.
            {documentoCliente(c) ? ' Para trazer o cliente de volta, use "Recuperar exclusão" com o ' + (c.pessoa === 'fisica' ? 'CPF.' : 'CNPJ.')
              : ' Atenção: este cliente não tem CPF/CNPJ cadastrado, então não poderá ser recuperado pela busca de documento.'}</p>
        </Confirmar>
      )}

      {editando ? (
        <FormCliente inicial={c} onCancelar={() => setEditando(false)} onSalvo={() => { setEditando(false); carregar(); }} />
      ) : (
        <div className="grade g2" style={{ marginBottom: 16, alignItems: 'start' }}>
          <section className="cartao">
            <h2>Dados cadastrais</h2>
            <table>
              <tbody>
                {!(c.pessoa === 'fisica' && c.ocultos?.includes('cpf')) && <tr><td className="suave">{c.pessoa === 'fisica' ? 'CPF' : 'CNPJ'}</td><td>{c.pessoa === 'fisica' ? (c.cpf ? mascara.cpf(c.cpf) : '—') : (c.cnpj ? mascara.cnpj(c.cnpj) : '—')}</td></tr>}
                <tr><td className="suave">Status</td><td>{c.ativo ? 'Ativo' : 'Inativo'}{c.status_alterado_em && <span className="suave pequeno"> · desde {fmt.data(c.status_alterado_em)}{c.status_alterado_por && ` por ${c.status_alterado_por}`}</span>}</td></tr>
                <tr><td className="suave">Marcas</td><td>{c.marcas.length ? (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>{c.marcas.map((m: string) => <span key={m} className="etiqueta">{m}</span>)}</div>
                ) : '—'}</td></tr>
                <tr><td className="suave">Telefone</td><td>{c.telefone ?? '—'}</td></tr>
                <tr><td className="suave">E-mail</td><td>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : '—'}</td></tr>
                <tr><td className="suave">Redes sociais</td><td><LinksRedesSociais valor={c.redes_sociais} /></td></tr>
                <tr><td className="suave">Endereço</td><td>{enderecoCompleto(c) || '—'}</td></tr>
                {c.agencia && <tr><td className="suave">Agência</td><td>{c.agencia}</td></tr>}
                <tr><td className="suave">Pagamento</td><td>{c.prazo_pagamento_dias} dias</td></tr>
              </tbody>
            </table>
          </section>
          <Colaboradores clienteId={id} lista={c.contatos} podeEditar={pode('M3', 'editar')} onMudou={carregar} />
        </div>
      )}

      <section className="grade g4" style={{ marginBottom: 16 }}>
        {([['', 'Total de eventos', eventos.length], ['aberto', 'Em aberto', qtd('aberto')], ['fechado', 'Fechados / finalizados', qtd('fechado')], ['cancelado', 'Cancelados', qtd('cancelado')]] as const).map(([g, rotulo, n]) => (
          <button key={rotulo} className="cartao kpi" onClick={() => setFiltro(g)}
                  style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit', borderColor: filtro === g ? 'var(--primaria)' : undefined }}>
            <div className="rotulo">{rotulo}</div><div className="valor">{n}</div>
            <div className="suave pequeno">{filtro === g ? 'filtro ativo' : 'clique para filtrar'}</div>
          </button>
        ))}
      </section>

      <div className="grade g2" style={{ alignItems: 'start' }}>
        <section className="cartao tabela">
          <h2>Eventos {filtro && <span className="suave pequeno" style={{ fontWeight: 400 }}>· {NOME_GRUPO[filtro]}</span>}</h2>
          {lista.length === 0 && <p className="suave">Nenhum evento {filtro ? 'nesta situação' : 'para este cliente'}.</p>}
          <table>
            <tbody>
              {lista.map((e) => (
                <tr key={e.id} onClick={() => setSelecionado(e.id)}
                    style={{ cursor: 'pointer', background: e.id === selecionado ? 'var(--primaria-clara)' : undefined }}>
                  <td>
                    <strong>{e.nome}</strong>
                    <div className="suave pequeno">{fmt.data(e.inicio)} · {e.praca}{e.local_nome && ` · ${e.local_nome}`}</div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={`etiqueta ${COR_GRUPO[grupo(e.status)]}`}>{NOME_GRUPO[grupo(e.status)]}</span>
                    <div className="suave pequeno" style={{ marginTop: 4 }}>{e.status.replace('_', ' ')}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {selecionado ? <DetalheEvento resumo={eventos.find((e) => e.id === selecionado)} /> : (
          <section className="cartao"><p className="suave">Selecione um evento para ver os detalhes.</p></section>
        )}
      </div>
    </>
  );
}

function DetalheEvento({ resumo }: { resumo: any }) {
  const { pode } = usePainel();
  const [ev, setEv] = useState<any>(null);
  const [fech, setFech] = useState<any>(null);

  useEffect(() => {
    setEv(null); setFech(null);
    if (pode('M4')) api(`/eventos/${resumo.id}`).then(setEv).catch(() => undefined);
    if (pode('M7') && resumo.status === 'fechado') api(`/eventos/${resumo.id}/fechamento`).then(setFech).catch(() => undefined);
  }, [resumo.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const g = grupo(resumo.status);
  const m = fech?.margem;
  const margem = m ? Number(m.receita ?? 0) - Number(m.custo_equipe ?? 0) - Number(m.custos_diretos ?? 0) : null;

  return (
    <section className="cartao">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'start' }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>{resumo.nome}</h2>
          <div className="suave pequeno">{resumo.marca && `${resumo.marca} · `}{resumo.praca}{resumo.local_nome && ` · ${resumo.local_nome}`}</div>
        </div>
        <span className={`etiqueta ${COR_GRUPO[g]}`}>{NOME_GRUPO[g]}</span>
      </div>

      <table style={{ marginTop: 12 }}>
        <tbody>
          <tr><td className="suave">Situação</td><td><span className={`etiqueta ${COR_STATUS[resumo.status]}`}>{resumo.status.replace('_', ' ')}</span></td></tr>
          <tr><td className="suave">Início</td><td>{fmt.diaSemana(resumo.inicio)}, {fmt.hora(resumo.inicio)}</td></tr>
          <tr><td className="suave">Fim</td><td>{fmt.diaSemana(resumo.fim)}, {fmt.hora(resumo.fim)}</td></tr>
          <tr><td className="suave">Escala</td><td>{resumo.confirmados}/{resumo.vagas} confirmados
            <div className="barra" style={{ marginTop: 4 }}><div style={{ width: `${resumo.vagas ? (100 * resumo.confirmados) / resumo.vagas : 0}%` }} /></div></td></tr>
          {ev?.endereco && <tr><td className="suave">Endereço</td><td>{ev.endereco}</td></tr>}
          {ev?.supervisores?.length > 0 && <tr><td className="suave">Supervisão</td><td>{ev.supervisores.map((s: any) => s.nome).join(', ')}</td></tr>}
          {ev?.descricao && <tr><td className="suave">Descrição</td><td>{ev.descricao}</td></tr>}
        </tbody>
      </table>

      {ev?.turnos?.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>Turnos e postos</h3>
          <table>
            <thead><tr><th>Turno</th><th>Função</th><th>Escala</th></tr></thead>
            <tbody>
              {ev.turnos.flatMap((t: any) => (t.postos.length ? t.postos : [null]).map((p: any, i: number) => (
                <tr key={`${t.id}-${p?.id ?? i}`}>
                  <td className="pequeno">{i === 0 && <><strong>{t.nome}</strong><div className="suave">{fmt.dataHora(t.inicio)}–{fmt.hora(t.fim)}</div></>}</td>
                  <td>{p?.funcao ?? <span className="suave">sem postos</span>}</td>
                  <td className="pequeno">{p && `${p.confirmados ?? 0}/${p.quantidade}`}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </>
      )}

      {ev?.checklist?.length > 0 && (
        <p className="suave pequeno" style={{ marginTop: 12 }}>
          Checklist: {ev.checklist.filter((i: any) => i.concluido_em).length} de {ev.checklist.length} itens concluídos
        </p>
      )}

      {fech && (
        <>
          <h3 style={{ marginTop: 16 }}>Fechamento</h3>
          <table>
            <tbody>
              <tr><td className="suave">Profissionais pagos</td><td>{fech.custos.length}</td></tr>
              {fech.fatura && <>
                <tr><td className="suave">Fatura</td><td>{fmt.moeda(fech.fatura.valor_total)} · {NOME_FATURA[fech.fatura.status] ?? fech.fatura.status}{fech.fatura.numero_nf && ` · NF ${fech.fatura.numero_nf}`}</td></tr>
                <tr><td className="suave">Vencimento</td><td>{fmt.data(`${String(fech.fatura.vencimento).slice(0, 10)}T12:00:00-03:00`)}{fech.fatura.recebido_em && ` · recebida em ${fmt.data(`${String(fech.fatura.recebido_em).slice(0, 10)}T12:00:00-03:00`)}`}</td></tr>
              </>}
              {m && <>
                <tr><td className="suave">Receita</td><td>{fmt.moeda(m.receita)}</td></tr>
                <tr><td className="suave">Custo (equipe + diretos)</td><td>{fmt.moeda(Number(m.custo_equipe ?? 0) + Number(m.custos_diretos ?? 0))}</td></tr>
                <tr><td className="suave">Margem</td><td><strong>{fmt.moeda(margem)}</strong>{Number(m.receita) > 0 && <span className="suave"> · {fmt.pct((100 * margem!) / Number(m.receita))}</span>}</td></tr>
              </>}
            </tbody>
          </table>
        </>
      )}

      {pode('M4') && <div style={{ marginTop: 16 }}><Link className="btn" href={`/eventos/${resumo.id}`}>Abrir evento completo</Link></div>}
    </section>
  );
}
