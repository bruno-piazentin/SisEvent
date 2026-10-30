'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, fmt } from '@/lib/api';
import { documentoCliente, NOME_TIPO_CLIENTE, soDigitos } from '@/lib/ui';
import { ExigeModulo, usePainel } from '@/components/Painel';
import { FormCliente } from '@/components/FormCliente';

export default function Clientes() {
  return <ExigeModulo modulo="M3"><Lista /></ExigeModulo>;
}

function Lista() {
  const { pode } = usePainel();
  const router = useRouter();
  const [clientes, setClientes] = useState<any[]>([]);
  const [novo, setNovo] = useState(false);
  const [busca, setBusca] = useState('');
  const [marca, setMarca] = useState('');
  const [catalogo, setCatalogo] = useState<any[]>([]);
  const [status, setStatus] = useState<'todos' | 'ativos' | 'inativos'>('todos');
  const [tipo, setTipo] = useState('');
  useEffect(() => { api('/clientes').then(setClientes); api('/marcas').then(setCatalogo).catch(() => undefined); }, []);

  const sem = (s?: string | null) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const termo = sem(busca.trim());
  const digitos = soDigitos(busca);
  const lista = clientes
    .filter((c) => status === 'todos' || (status === 'ativos' ? c.ativo : !c.ativo))
    .filter((c) => !tipo || c.tipo === tipo)
    .filter((c) => !marca || c.marcas.includes(marca))
    .filter((c) => !termo
      || [c.nome_fantasia, c.razao_social, c.cidade, c.email, ...c.marcas].some((v) => sem(v).includes(termo))
      || (digitos.length >= 3 && [c.cnpj, c.cpf].some((d) => d?.includes(digitos))));
  const inativos = clientes.filter((c) => !c.ativo).length;

  return (
    <>
      <div className="topo"><div><h1>Clientes</h1>
        <div className="suave">{clientes.length} cadastrado(s) · {clientes.length - inativos} ativo(s) · {inativos} inativo(s)</div></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn" href="/clientes/relatorio">Relatórios</Link>
          {pode('M3', 'excluir') && <Link className="btn" href="/clientes/recuperar">Recuperar exclusão</Link>}
          {pode('M3', 'criar') && !novo && <button className="btn primario" onClick={() => setNovo(true)}>Novo cliente</button>}
        </div>
      </div>
      {novo && <FormCliente onCancelar={() => setNovo(false)} onSalvo={(id) => router.push(`/clientes/${id}`)} />}
      <div className="cartao tabela">
        <div className="filtros">
          <label style={{ flex: '2 1 240px' }}>Buscar<input placeholder="Nome, CNPJ/CPF, cidade, e-mail ou marca" value={busca} onChange={(e) => setBusca(e.target.value)} /></label>
          <label>Status
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="todos">Todos</option><option value="ativos">Ativos</option><option value="inativos">Inativos</option>
            </select>
          </label>
          <label>Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              <option value="">Todos os tipos</option>
              {Object.entries(NOME_TIPO_CLIENTE).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
            </select>
          </label>
          <label>Marca
            <select value={marca} onChange={(e) => setMarca(e.target.value)}>
              <option value="">Todas as marcas</option>
              {catalogo.filter((m) => m.clientes > 0).map((m) => <option key={m.id} value={m.nome}>{m.nome} ({m.clientes})</option>)}
            </select>
          </label>
        </div>
        <table>
          <thead><tr><th>Cliente</th><th>Contato</th><th>Cidade</th><th>Colaboradores</th><th>Eventos</th><th>Último evento</th></tr></thead>
          <tbody>
            {lista.map((c) => (
              <tr key={c.id} style={{ cursor: 'pointer' }} title="Abrir ficha do cliente" onClick={() => router.push(`/clientes/${c.id}`)}>
                <td><Link href={`/clientes/${c.id}`}><strong>{c.nome_fantasia ?? c.razao_social}</strong></Link>
                  {!c.ativo && <span className="etiqueta neutra" style={{ marginLeft: 6 }}>Inativo</span>}
                  <div className="suave pequeno">{NOME_TIPO_CLIENTE[c.tipo] ?? c.tipo}{c.pessoa === 'fisica' && ' · pessoa física'}{documentoCliente(c) && ` · ${documentoCliente(c)}`}{c.agencia && ` · via ${c.agencia}`}</div>
                  {c.marcas.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {c.marcas.map((m: string) => <span key={m} className="etiqueta neutra">{m}</span>)}</div>}</td>
                <td className="pequeno">{c.telefone ?? '—'}<div className="suave">{c.email}</div></td>
                <td>{c.cidade ? `${c.cidade}/${c.uf}` : '—'}</td>
                <td>{c.colaboradores}</td>
                <td>{c.eventos}</td>
                <td>{fmt.data(c.ultimo_evento)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lista.length === 0 && <p className="suave">Nenhum cliente encontrado.</p>}
      </div>
    </>
  );
}
