import { PipeTransform } from '@nestjs/common';
import { z, ZodTypeAny } from 'zod';

/** Pipe de validação com Zod: @Body(new Validar(Esquema)) corpo: z.infer<typeof Esquema> */
export class Validar<T extends ZodTypeAny> implements PipeTransform {
  constructor(private readonly esquema: T) {}
  transform(valor: unknown): z.infer<T> {
    return this.esquema.parse(valor);
  }
}

export const uuid = z.string().uuid();
export const dataHora = z.coerce.date();
export const dinheiro = z.coerce.number().nonnegative().multipleOf(0.01);

/** Número inteiro; casas decimais são arredondadas (39,5 → 40) em vez de recusar */
export const inteiro = () => z.preprocess((v) => (typeof v === 'number' ? Math.round(v) : v), z.number().int());

/** Altura em cm; quem digita em metros (1,70) também é aceito e vira 170 */
export const alturaCm = z.preprocess((v) => (typeof v === 'number' ? Math.round(v < 3 ? v * 100 : v) : v),
  z.number().int().min(50, 'Altura em cm: use, por exemplo, 170').max(250, 'Altura em cm: use, por exemplo, 170'));

/**
 * Celular gravado como +55DDDNÚMERO. Aceita como a pessoa digita: (43) 99999-0000, 43999990000,
 * 55 43 99999-0000 ou +5543999990000. Sem o 55, assume Brasil.
 */
export const celular = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  const d = v.replace(/\D/g, '').replace(/^0+/, '');
  if (v.trim().startsWith('+')) return `+${d}`;
  return `+${d.length <= 11 ? `55${d}` : d}`;
}, z.string().regex(/^\+\d{12,13}$/, 'Celular com DDD, por exemplo (43) 99999-0000'));

/** Redes sociais de cliente e profissional: só as redes conhecidas, texto vazio é descartado */
export const REDES = ['instagram', 'tiktok', 'facebook', 'linkedin', 'youtube', 'x', 'site'] as const;
export const RedesSociais = z
  .object(Object.fromEntries(REDES.map((r) => [r, z.string().trim().max(200).nullish()])) as Record<(typeof REDES)[number], z.ZodOptional<z.ZodNullable<z.ZodString>>>)
  .strict()
  .transform((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, string>);

/** Dígitos verificadores do CPF */
export function cpfValido(c: string) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i);
    if (((s * 10) % 11) % 10 !== Number(c[n])) return false;
  }
  return true;
}

/** Dígitos verificadores do CNPJ */
export function cnpjValido(c: string) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const dv = (n: number) => {
    let s = 0;
    // pesos 2..9 aplicados da direita para a esquerda, recomeçando em 2
    for (let i = 0; i < n; i++) s += Number(c[i]) * (((n - 1 - i) % 8) + 2);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

/** Dados de cadastro comuns a cliente e empresa: identificação, contato, redes e endereço */
export const DadosCadastrais = z.object({
  pessoa: z.enum(['juridica', 'fisica']).default('juridica'),
  razao_social: z.string().min(2),           // pessoa física: nome completo
  nome_fantasia: z.string().nullish(),       // pessoa física: como é chamada
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ com 14 dígitos').nullish(),
  cpf: z.string().regex(/^\d{11}$/, 'CPF com 11 dígitos').nullish(),
  telefone: z.string().nullish(),
  email: z.string().email('E-mail da empresa inválido').nullish(),
  redes_sociais: RedesSociais.optional(),
  cep: z.string().regex(/^\d{8}$/, 'CEP com 8 dígitos').nullish(),
  logradouro: z.string().nullish(),
  numero: z.string().nullish(),
  complemento: z.string().nullish(),
  bairro: z.string().nullish(),
  cidade: z.string().nullish(),
  uf: z.string().length(2).transform((s) => s.toUpperCase()).nullish(),
});

/** Nota de 1 a 5 (5 Excelente … 1 Péssimo). Nota 1 exige o relato do motivo; nas demais o comentário é opcional. */
const CamposAvaliacao = z.object({
  nota: z.number().int().min(1, 'Escolha uma nota de 1 a 5.').max(5, 'Escolha uma nota de 1 a 5.'),
  comentario: z.string().trim().max(2000).nullish(),
});
const nota1ComRelato = (a: { nota: number; comentario?: string | null }) => a.nota > 1 || (a.comentario ?? '').length >= 10;
const msgNota1 = { message: 'Para a nota 1, conte o que motivou a nota (pelo menos 10 letras).', path: ['comentario'] };
export const Avaliacao = CamposAvaliacao.refine(nota1ComRelato, msgNota1);
/** A mesma nota, dada pelo profissional ao evento */
export const AvaliacaoEvento = CamposAvaliacao.extend({ evento_id: uuid }).refine(nota1ComRelato, msgNota1);
