import { CORES_CABELO, TIPOS_CABELO } from './ui';

const STATUS: Record<string, string> = { ativo: 'Ativo', em_teste: 'Em teste', inativo: 'Inativo', bloqueado: 'Bloqueado' };
const GENEROS: Record<string, string> = { feminino: 'Feminino', masculino: 'Masculino', nao_binario: 'Não binário' };

const dataHora = (v: string) => new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Só os filtros realmente preenchidos */
export const filtrosAtivos = (f: Record<string, string>) =>
  Object.fromEntries(Object.entries(f).filter(([k, v]) => v && !['pagina', 'por_pagina'].includes(k)));

/** Filtros da busca de profissionais em texto legível: ["Função: Promotor(a)", "Cabelo: Ruivo", ...] */
export function descreverFiltros(f: Record<string, string>, funcoes: { id: string; nome: string }[], pracas: { id: string; nome: string; uf: string }[]) {
  const d: string[] = [];
  if (f.q) d.push(`Nome contém “${f.q}”`);
  if (f.funcao) d.push(`Função: ${funcoes.find((x) => x.id === f.funcao)?.nome ?? '—'}`);
  if (f.praca) { const p = pracas.find((x) => x.id === f.praca); d.push(`Praça: ${p ? `${p.nome}/${p.uf}` : '—'}`); }
  if (f.status) d.push(`Status: ${STATUS[f.status] ?? f.status}`);
  if (f.genero) d.push(`Gênero: ${GENEROS[f.genero] ?? f.genero}`);
  if (f.altura_min) d.push(`Altura a partir de ${f.altura_min} cm`);
  if (f.tamanho) d.push(`Camiseta ${f.tamanho}`);
  if (f.cor_cabelo) d.push(`Cor do cabelo: ${f.cor_cabelo.split(',').map((c) => CORES_CABELO[c] ?? c).join(' ou ')}`);
  if (f.tipo_cabelo) d.push(`Tipo de cabelo: ${f.tipo_cabelo.split(',').map((c) => TIPOS_CABELO[c] ?? c).join(' ou ')}`);
  if (f.livre_inicio && f.livre_fim) d.push(`Livre de ${dataHora(f.livre_inicio)} até ${dataHora(f.livre_fim)}`);
  if (f.conducao_propria) d.push('Com condução própria');
  return d;
}
