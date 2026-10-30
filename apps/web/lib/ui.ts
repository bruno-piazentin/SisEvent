export const COR_STATUS: Record<string, string> = {
  planejamento: 'neutra', confirmado: '', em_execucao: 'alerta', encerrado: 'alerta', fechado: 'ok', cancelado: 'erro',
};

export const soDigitos = (s?: string | null) => (s ?? '').replace(/\D/g, '');

/** Máscaras de exibição (o banco guarda só os dígitos do CNPJ e do CEP) */
export const mascara = {
  cnpj: (s?: string | null) => soDigitos(s).slice(0, 14)
    .replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2'),
  cpf: (s?: string | null) => soDigitos(s).slice(0, 11)
    .replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2'),
  cep: (s?: string | null) => soDigitos(s).slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2'),
  telefone: (s?: string | null) => {
    const d = soDigitos(s).slice(0, 11);
    if (d.length <= 2) return d;
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  },
};

export const NOME_TIPO_CLIENTE: Record<string, string> = {
  agencia: 'Agência', produtora: 'Produtora', industria: 'Indústria', representante: 'Representante',
  revenda: 'Revenda', supermercado: 'Supermercado', outro: 'Outro',
};

/** "CNPJ 00.000.000/0000-00" ou "CPF 000.000.000-00" conforme o tipo de pessoa */
export const documentoCliente = (c: any) =>
  c.pessoa === 'fisica' ? (c.cpf ? `CPF ${mascara.cpf(c.cpf)}` : '') : (c.cnpj ? `CNPJ ${mascara.cnpj(c.cnpj)}` : '');

/** Endereço do cliente numa linha */
export const enderecoCompleto = (c: any) => [
  [c.logradouro, c.numero].filter(Boolean).join(', '), c.complemento, c.bairro,
  [c.cidade, c.uf].filter(Boolean).join('/'), c.cep && `CEP ${mascara.cep(c.cep)}`,
].filter(Boolean).join(' · ');

/** Redes sociais aceitas (mesma lista da API) e como montar o link de cada uma */
export const REDES: { chave: string; nome: string; exemplo: string; url: (v: string) => string }[] = [
  { chave: 'instagram', nome: 'Instagram', exemplo: '@perfil', url: (v) => `https://instagram.com/${v.replace(/^@/, '')}` },
  { chave: 'tiktok', nome: 'TikTok', exemplo: '@perfil', url: (v) => `https://tiktok.com/@${v.replace(/^@/, '')}` },
  { chave: 'facebook', nome: 'Facebook', exemplo: 'facebook.com/pagina', url: (v) => `https://facebook.com/${v.replace(/^(https?:\/\/)?(www\.)?facebook\.com\//, '')}` },
  { chave: 'linkedin', nome: 'LinkedIn', exemplo: 'linkedin.com/in/perfil', url: (v) => (v.includes('linkedin.com') ? `https://${v.replace(/^https?:\/\//, '')}` : `https://linkedin.com/in/${v}`) },
  { chave: 'youtube', nome: 'YouTube', exemplo: '@canal', url: (v) => (v.includes('youtube.com') ? `https://${v.replace(/^https?:\/\//, '')}` : `https://youtube.com/${v.startsWith('@') ? v : `@${v}`}`) },
  { chave: 'x', nome: 'X (Twitter)', exemplo: '@perfil', url: (v) => `https://x.com/${v.replace(/^@/, '')}` },
  { chave: 'site', nome: 'Site', exemplo: 'www.site.com.br', url: (v) => (/^https?:\/\//.test(v) ? v : `https://${v}`) },
];

export const TIPOS_CABELO: Record<string, string> = { liso: 'Liso', ondulado: 'Ondulado', cacheado: 'Cacheado', crespo: 'Crespo', raspado: 'Raspado / careca' };
export const CORES_CABELO: Record<string, string> = { preto: 'Preto', castanho: 'Castanho', loiro: 'Loiro', ruivo: 'Ruivo', grisalho: 'Grisalho / branco', colorido: 'Colorido / fantasia' };

export const nomeColaborador =(ct: any) => [ct.nome, ct.sobrenome].filter(Boolean).join(' ');

/** Baixa um CSV que o Excel abre direto (separador ";" e BOM para acentos) */
export function baixarCsv(nome: string, linhas: (string | number | null | undefined)[][]) {
  const csv = linhas.map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nome });
  a.click();
  URL.revokeObjectURL(url);
}
