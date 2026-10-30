'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, fmt } from '@/lib/api';
import { baixarCsv, CORES_CABELO, TIPOS_CABELO } from '@/lib/ui';
import { descreverFiltros } from '@/lib/filtrosProfissionais';
import { ExigeModulo, usePainel } from '@/components/Painel';
import { redesEmTexto } from '@/components/RedesSociais';

const STATUS: Record<string, string> = { ativo: 'Ativo', em_teste: 'Em teste', inativo: 'Inativo', bloqueado: 'Bloqueado' };
const POR_PAGINA = 200;   // limite da API por página: o relatório busca todas as páginas

export default function RelatorioProfissionais() {
  return <ExigeModulo modulo="M1"><Suspense><Relatorio /></Suspense></ExigeModulo>;
}

const cabelo = (p: any) => [p.cor_cabelo && CORES_CABELO[p.cor_cabelo], p.tipo_cabelo && TIPOS_CABELO[p.tipo_cabelo]].filter(Boolean).join(' · ');

function Relatorio() {
  const { me } = usePainel();
  const params = useSearchParams();
  const filtros = Object.fromEntries([...params.entries()].filter(([k]) => k !== 'todos'));
  const [itens, setItens] = useState<any[] | null>(null);
  const [cat, setCat] = useState<{ funcoes: any[]; pracas: any[] }>({ funcoes: [], pracas: [] });
  const [erro, setErro] = useState('');

  useEffect(() => {
    Promise.all([api('/funcoes'), api('/pracas')]).then(([funcoes, pracas]) => setCat({ funcoes, pracas }));
    (async () => {
      const todos: any[] = [];
      for (let pagina = 1; ; pagina++) {
        const r = await api(`/profissionais?${new URLSearchParams({ ...filtros, pagina: String(pagina), por_pagina: String(POR_PAGINA) })}`);
        todos.push(...r.itens);
        if (todos.length >= r.total || r.itens.length < POR_PAGINA) break;
      }
      setItens(todos.sort((a, b) => (a.nome_artistico ?? a.nome).localeCompare(b.nome_artistico ?? b.nome, 'pt-BR')));
    })().catch((e) => setErro(e.message));
  }, [params.toString()]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro) return <div className="aviso erro">{erro}</div>;
  if (!itens) return <div className="suave">Gerando relatório…</div>;
  const lista = itens;

  const descricao = descreverFiltros(filtros, cat.funcoes, cat.pracas);
  const contar = (s: string) => lista.filter((p) => p.status === s).length;

  function exportar() {
    baixarCsv(`profissionais-${new Date().toISOString().slice(0, 10)}.csv`, [
      ...(descricao.length ? [['Filtros', descricao.join('; ')], []] : []),
      ['Nome', 'Nome artístico', 'Funções', 'Praça base', 'Cidade', 'UF', 'Celular', 'E-mail', 'Redes sociais', 'Idade', 'Gênero',
        'Altura (cm)', 'Camiseta', 'Cor do cabelo', 'Tipo de cabelo', 'Locomoção', 'Jobs', 'Faltas', 'Nota média', 'Status'],
      ...lista.map((p) => [p.nome, p.nome_artistico, (p.funcoes ?? []).join(', '), p.praca_base, p.cidade, p.uf, p.celular, p.email,
        redesEmTexto(p.redes_sociais), p.idade, p.genero, p.altura_cm, p.tamanho_camiseta,
        p.cor_cabelo && CORES_CABELO[p.cor_cabelo], p.tipo_cabelo && TIPOS_CABELO[p.tipo_cabelo],
        (p.meios_locomocao ?? []).join(', ').replaceAll('_', ' '), p.jobs_finalizados ?? 0, p.faltas ?? 0, p.nota_media, STATUS[p.status] ?? p.status]),
    ]);
  }

  return (
    <div className="relatorio">
      <div className="topo nao-imprimir">
        <div><div className="suave pequeno"><Link href="/profissionais">Banco de talentos</Link> / Relatório</div><h1>Relatório de profissionais</h1></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportar}>Exportar planilha (CSV)</button>
          <button className="btn primario" onClick={() => window.print()}>Imprimir / salvar PDF</button>
        </div>
      </div>

      <div className="cartao">
        <div className="cabecalho-relatorio">
          <div>
            <h1 style={{ margin: 0 }}>Profissionais {descricao.length ? '(com filtros)' : '(todos)'}</h1>
            <div className="suave pequeno">{me.empresa.nome} · emitido em {fmt.dataHora(new Date())} por {me.usuario.nome}</div>
          </div>
        </div>

        <p className="pequeno" style={{ marginTop: 0 }}>
          {descricao.length ? <>Filtros: {descricao.join(' · ')}</> : 'Sem filtros: todos os profissionais cadastrados.'}
        </p>
        <p className="pequeno"><strong>{itens.length}</strong> profissional(is) · ativos {contar('ativo')} · em teste {contar('em_teste')} · inativos {contar('inativo')} · bloqueados {contar('bloqueado')}</p>

        {itens.length === 0 ? <p className="suave">Nenhum profissional atende a esses filtros.</p> : (
          <div className="tabela">
            <table>
              <thead><tr><th>Profissional</th><th>Funções</th><th>Praça</th><th>Contato</th><th>Perfil</th><th>Histórico</th><th>Status</th></tr></thead>
              <tbody>
                {itens.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/profissionais/${p.id}`}><strong>{p.nome_artistico ?? p.nome}</strong></Link>
                      {p.nome_artistico && <div className="suave">{p.nome}</div>}</td>
                    <td>{(p.funcoes ?? []).join(', ') || '—'}</td>
                    <td>{p.praca_base ?? (p.cidade ? `${p.cidade}/${p.uf}` : '—')}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{p.celular}<div className="suave">{p.email}</div></td>
                    <td>{[p.idade && `${p.idade} anos`, p.altura_cm && `${p.altura_cm} cm`, p.tamanho_camiseta && `cam. ${p.tamanho_camiseta}`].filter(Boolean).join(' · ') || '—'}
                      {cabelo(p) && <div className="suave">Cabelo: {cabelo(p)}</div>}</td>
                    <td>{p.jobs_finalizados ? `${p.jobs_finalizados} jobs · ${p.faltas} falta(s)` : 'sem histórico'}{p.nota_media && <div>★ {p.nota_media}</div>}</td>
                    <td>{STATUS[p.status] ?? p.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
