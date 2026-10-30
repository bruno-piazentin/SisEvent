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

/** Redes sociais de cliente e profissional: só as redes conhecidas, texto vazio é descartado */
export const REDES = ['instagram', 'tiktok', 'facebook', 'linkedin', 'youtube', 'x', 'site'] as const;
export const RedesSociais = z
  .object(Object.fromEntries(REDES.map((r) => [r, z.string().trim().max(200).nullish()])) as Record<(typeof REDES)[number], z.ZodOptional<z.ZodNullable<z.ZodString>>>)
  .strict()
  .transform((o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Record<string, string>);
