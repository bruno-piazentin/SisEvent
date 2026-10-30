import { Body, Controller, Get, HttpCode, HttpException, Ip, Param, Post, Inject } from '@nestjs/common';
import { z } from 'zod';
import { DbService } from '../db/db.service';
import { Validar, uuid } from '../comum/validacao';
import { Publico } from '../auth/decorators';

/**
 * Área do profissional — acesso SOMENTE pelo link mágico (/p/<token>), sem senha e sem app.
 * Não há contexto de empresa aqui: as funções do banco (SECURITY DEFINER) descobrem a empresa
 * e o profissional a partir do token, e só devolvem dados dele.
 */
const Ponto = z.object({
  evento_id: uuid,
  tipo: z.enum(['checkin', 'checkout']),
  codigo_qr: z.string().regex(/^\d{6}$/).nullish(),
  dispositivo_em: z.coerce.date().nullish(),     // hora da leitura no celular (fila offline)
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  selfie_url: z.string().url().nullish(),
});
const Resposta = z.object({ alocacao_id: uuid, aceita: z.boolean(), motivo: z.string().max(300).nullish() });
const Token = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);

// Limite simples por IP contra tentativa de adivinhar tokens. Em produção com várias
// instâncias, trocar por Redis (ou pelo rate limit do proxy/CDN).
const tentativas = new Map<string, { n: number; ate: number }>();
function limitar(ip: string, max = 60, janelaMs = 60_000) {
  const agora = Date.now();
  const t = tentativas.get(ip);
  if (!t || t.ate < agora) { tentativas.set(ip, { n: 1, ate: agora + janelaMs }); return; }
  if (++t.n > max) throw new HttpException({ codigo: 'muitas_tentativas', mensagem: 'Aguarde um minuto e tente de novo.' }, 429);
}
setInterval(() => { const a = Date.now(); for (const [k, v] of tentativas) if (v.ate < a) tentativas.delete(k); }, 60_000).unref();

@Publico()
@Controller('publico')
export class PublicoController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get('p/:token')
  async area(@Param('token') token: string, @Ip() ip: string) {
    limitar(ip);
    Token.parse(token);
    return this.db.tx({}, (tx) => tx.um('SELECT area_profissional($1) AS r', [token])).then((x) => x!.r);
  }

  @Post('p/:token/responder')
  @HttpCode(200)
  async responder(@Param('token') token: string, @Ip() ip: string, @Body(new Validar(Resposta)) dto: z.infer<typeof Resposta>) {
    limitar(ip);
    Token.parse(token);
    return this.db.tx({}, (tx) =>
      tx.um('SELECT responder_convocacao($1, $2, $3, $4) AS r', [token, dto.alocacao_id, dto.aceita, dto.motivo ?? null]),
    ).then((x) => x!.r);
  }

  /** Check-in / check-out. Idempotente: a fila offline do celular pode reenviar sem duplicar. */
  @Post('p/:token/ponto')
  @HttpCode(200)
  async ponto(@Param('token') token: string, @Ip() ip: string, @Body(new Validar(Ponto)) dto: z.infer<typeof Ponto>) {
    limitar(ip, 30);
    Token.parse(token);
    return this.db.tx({}, (tx) =>
      tx.um('SELECT registrar_ponto($1, $2, $3, $4, $5, $6, $7, $8) AS r', [
        token, dto.evento_id, dto.tipo, dto.codigo_qr ?? null, dto.dispositivo_em ?? null,
        dto.lat ?? null, dto.lng ?? null, dto.selfie_url ?? null,
      ]),
    ).then((x) => x!.r);
  }

  @Get('saude')
  async saude() {
    const r = await this.db.tx({}, (tx) => tx.um('SELECT now() AS agora'));
    return { ok: true, banco: r?.agora };
  }
}
