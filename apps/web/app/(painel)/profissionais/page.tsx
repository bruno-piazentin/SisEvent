'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { ExigeModulo, usePainel } from '@/components/Painel';
import { useRouter } from 'next/navigation';
import { CORES_CABELO, TIPOS_CABELO } from '@/lib/ui';
import { descreverFiltros, filtrosAtivos } from '@/lib/filtrosProfissionais';

const STATUS_CLASSE: Record<string, string> = { ativo: 'ok', em_teste: 'alerta', inativo: 'neutra', bloqueado: 'erro' };

export default function Profissionais() {
  return <ExigeModulo modulo="M1"><Lista /></ExigeModulo>;
}

function Lista() {
  const { pode } = usePainel();
  const router = useRouter();
  const [f, setF] = useState<Record<string, string>>({ status: 'ativo' });
  const [dados, setDados] = useState<{ total: number; itens: any[] }>({ total: 0, itens: [] });
  const [pracas, setPracas] = useState<any[]>([]);
  const [funcoes, setFuncoes] = useState<any[]>([]);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    api('/pracas').then(setPracas);
    api('/funcoes').then(setFuncoes);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
      setCarregando(true);
      api(`/profissionais?${qs}`).then(setDados).finally(() => setCarregando(false));
    }, 250);
    return () => clearTimeout(t);
  }, [f]);

  const [perguntar, setPerguntar] = useState(false);
  const descricao = descreverFiltros(filtrosAtivos(f), funcoes, pracas);
  // "todos" vai sem nenhum filtro (nem o status "ativo" que a busca usa por padrão)
  const abrirRelatorio = (manter: boolean) =>
    router.push(`/profissionais/relatorio?${new URLSearchParams(manter ? filtrosAtivos(f) : { todos: '1' })}`);

  const muda = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? ((e.target as HTMLInputElement).checked ? 'true' : '') : e.target.value }));

  return (
    <>
      <div className="topo">
        <div><h1>Banco de talentos</h1><div className="suave">{dados.total} profissional(is) {carregando && '· buscando…'}</div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => (descricao.length ? setPerguntar(true) : abrirRelatorio(false))}>Relatório</button>
          {pode('M1', 'criar') && <Link className="btn primario" href="/profissionais/novo">Novo profissional</Link>}
        </div>
      </div>

      {perguntar && (
        <div role="presentation" onClick={() => setPerguntar(false)}
             style={{ position: 'fixed', inset: 0, background: 'rgba(20,10,30,.45)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 50 }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="rel-titulo" className="cartao" onClick={(e) => e.stopPropagation()}
               style={{ maxWidth: 480, width: '100%' }}>
            <h2 id="rel-titulo">Gerar relatório de profissionais</h2>
            <p>Há filtros aplicados na busca. Deseja manter esses filtros no relatório?</p>
            <ul className="pequeno" style={{ marginTop: 0 }}>{descricao.map((d) => <li key={d}>{d}</li>)}</ul>
            <p className="suave pequeno">Com filtros: {dados.total} profissional(is). Sem filtros: todos os cadastrados.</p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => setPerguntar(false)}>Cancelar</button>
              <button className="btn" onClick={() => abrirRelatorio(false)}>Todos os profissionais</button>
              <button className="btn primario" autoFocus onClick={() => abrirRelatorio(true)}>Manter filtros</button>
            </div>
          </div>
        </div>
      )}

      <div className="cartao">
        <div className="filtros">
          <label>Nome<input placeholder="Buscar…" value={f.q ?? ''} onChange={muda('q')} /></label>
          <label>Função
            <select value={f.funcao ?? ''} onChange={muda('funcao')}>
              <option value="">Todas</option>{funcoes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </label>
          <label>Praça
            <select value={f.praca ?? ''} onChange={muda('praca')}>
              <option value="">Todas</option>{pracas.map((x) => <option key={x.id} value={x.id}>{x.nome}/{x.uf}</option>)}
            </select>
          </label>
          <label>Status
            <select value={f.status ?? ''} onChange={muda('status')}>
              <option value="">Todos</option><option value="ativo">Ativo</option><option value="em_teste">Em teste</option>
              <option value="inativo">Inativo</option><option value="bloqueado">Bloqueado</option>
            </select>
          </label>
          <label>Gênero
            <select value={f.genero ?? ''} onChange={muda('genero')}>
              <option value="">Todos</option><option value="feminino">Feminino</option><option value="masculino">Masculino</option>
            </select>
          </label>
          <label>Altura mín. (cm)<input type="number" value={f.altura_min ?? ''} onChange={muda('altura_min')} /></label>
          <label>Camiseta
            <select value={f.tamanho ?? ''} onChange={muda('tamanho')}>
              <option value="">Todos</option>{['PP', 'P', 'M', 'G', 'GG', 'XG'].map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Cor do cabelo
            <select value={f.cor_cabelo ?? ''} onChange={muda('cor_cabelo')}>
              <option value="">Todas</option>{Object.entries(CORES_CABELO).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
          <label>Tipo de cabelo
            <select value={f.tipo_cabelo ?? ''} onChange={muda('tipo_cabelo')}>
              <option value="">Todos</option>{Object.entries(TIPOS_CABELO).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
          <label>Livre de<input type="datetime-local" value={f.livre_inicio ?? ''} onChange={muda('livre_inicio')} /></label>
          <label>até<input type="datetime-local" value={f.livre_fim ?? ''} onChange={muda('livre_fim')} /></label>
          <label style={{ flexDirection: 'row', display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" style={{ width: 'auto' }} checked={!!f.conducao_propria} onChange={muda('conducao_propria')} />
            Condução própria
          </label>
        </div>

        <div className="tabela">
          <table>
            <thead><tr><th>Nome</th><th>Funções</th><th>Praça</th><th>Perfil</th><th>Histórico</th><th>Status</th></tr></thead>
            <tbody>
              {dados.itens.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/profissionais/${p.id}`}><strong>{p.nome_artistico ?? p.nome}</strong></Link>
                    <div className="suave pequeno">{p.celular}</div></td>
                  <td className="pequeno">{(p.funcoes ?? []).join(', ')}</td>
                  <td className="pequeno">{p.praca_base ?? p.cidade}</td>
                  <td className="pequeno">{[p.idade && `${p.idade} anos`, p.altura_cm && `${p.altura_cm} cm`, p.tamanho_camiseta && `cam. ${p.tamanho_camiseta}`,
                    (p.cor_cabelo || p.tipo_cabelo) && `cabelo ${[p.cor_cabelo && CORES_CABELO[p.cor_cabelo], p.tipo_cabelo && TIPOS_CABELO[p.tipo_cabelo]].filter(Boolean).join(' ').toLowerCase()}`]
                    .filter(Boolean).join(' · ')}
                    <div className="suave">{(p.meios_locomocao ?? []).join(', ').replaceAll('_', ' ')}</div></td>
                  <td className="pequeno">{p.jobs_finalizados ? `${p.jobs_finalizados} jobs · ${p.faltas} falta(s)` : 'sem histórico'}
                    {p.nota_media && <div>★ {p.nota_media}</div>}</td>
                  <td><span className={`etiqueta ${STATUS_CLASSE[p.status]}`}>{p.status.replace('_', ' ')}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
