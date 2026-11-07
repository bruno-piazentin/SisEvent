import { Body, Controller, Get, Param, Post, Inject } from '@nestjs/common';
import { z } from 'zod';
import { DbService, ContextoDb } from '../db/db.service';
import { Validar, uuid } from '../comum/validacao';
import { Ctx, Requer, Usuario, UsuarioLogado, EscopoEvento } from '../auth/decorators';
import { garantirAcessoEvento } from '../eventos/escopo';
import { config } from '../config';

const PontoManual = z.object({
  tipo: z.enum(['checkin', 'checkout', 'falta', 'falta_justificada']),
  momento: z.coerce.date().default(() => new Date()),
  observacao: z.string().min(5, 'Explique o motivo do lançamento manual'),
});
const Ocorrencia = z.object({
  alocacao_id: uuid.nullish(),
  tipo: z.enum(['uniforme', 'conduta', 'incidente_publico', 'material', 'atraso', 'substituicao', 'outro']),
  gravidade: z.number().int().min(1).max(3).default(1),
  descricao: z.string().min(5),
  fotos: z.array(z.string().url()).default([]),
});

/** M6 — Execução em campo (tela do supervisor) */
@Controller()
export class CampoController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * QR rotativo para exibir no celular/tablet do supervisor. A tela consulta a cada ~5 s.
   * O código vale 30 s (+30 s de tolerância), então foto do QR enviada a um colega expira.
   */
  @Get('eventos/:id/qr')
  @Requer('M6', 'ver')
  qr(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      await garantirAcessoEvento(tx, u, id);
      const r = await tx.um<{ codigo: string; segundos: number; nome: string }>(
        `SELECT qr_codigo(e.id) AS codigo, e.nome,
                30 - (floor(extract(epoch FROM now()))::bigint % 30) AS segundos
           FROM evento e WHERE e.id = $1`, [id]);
      return {
        evento: r!.nome,
        codigo: r!.codigo,
        url: `${config.appUrl}/c/${id}/${r!.codigo}`,
        expira_em_segundos: Number(r!.segundos),
      };
    });
  }

  /** Painel de presença ao vivo: quem chegou, quem está atrasado, quem não apareceu */
  @Get('eventos/:id/presenca')
  @Requer('M6', 'ver')
  presenca(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      await garantirAcessoEvento(tx, u, id);
      const linhas = await tx.q(
        `SELECT a.id AS alocacao_id, pr.nome, pr.celular, pr.foto_url, f.nome AS funcao, t.nome AS turno, t.inicio, t.fim,
                ap.status AS presenca, ap.checkin_em, ap.checkout_em, ap.atraso_min, ap.suspeito, ap.observacao,
                CASE
                  WHEN ap.checkout_em IS NOT NULL THEN 'saiu'
                  WHEN ap.checkin_em IS NOT NULL THEN 'presente'
                  WHEN ap.status IN ('falta','falta_justificada') THEN ap.status::text
                  WHEN now() > t.inicio + make_interval(mins => e.tolerancia_atraso_min) THEN 'atrasado'
                  ELSE 'aguardando'
                END AS situacao
           FROM alocacao a
           JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id JOIN evento e ON e.id = t.evento_id
           JOIN funcao f ON f.id = p.funcao_id JOIN profissional pr ON pr.id = a.profissional_id
           LEFT JOIN apontamento ap ON ap.alocacao_id = a.id
          WHERE t.evento_id = $1 AND a.status = 'confirmado' AND a.tipo = 'titular'
          ORDER BY t.inicio, situacao, pr.nome`, [id]);
      const resumo = linhas.reduce((acc: Record<string, number>, l) => ({ ...acc, [l.situacao]: (acc[l.situacao] ?? 0) + 1 }), {});
      return { resumo, total: linhas.length, linhas };
    });
  }

  /** Lançamento pelo supervisor (celular do promotor sem bateria/sinal) — exige observação */
  @Post('alocacoes/:id/ponto-manual')
  @Requer('M6', 'editar')
  @EscopoEvento('alocacao')
  pontoManual(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(PontoManual)) dto: z.infer<typeof PontoManual>) {
    uuid.parse(id);
    return this.db.tx({ ...ctx, motivo: dto.observacao }, (tx) =>
      tx.um('SELECT * FROM registrar_ponto_supervisor($1, $2, $3, $4)', [id, dto.tipo, dto.momento, dto.observacao]));
  }

  /** Substituição em campo: quem faltou sai, o substituto entra confirmado no mesmo posto */
  @Post('alocacoes/:id/substituir')
  @Requer('M6', 'editar')
  @EscopoEvento('alocacao')
  substituir(@Ctx() ctx: ContextoDb, @Param('id') id: string,
             @Body(new Validar(z.object({ substituto_id: uuid, motivo: z.string().min(5) }))) dto: { substituto_id: string; motivo: string }) {
    uuid.parse(id);
    return this.db.tx({ ...ctx, motivo: dto.motivo }, (tx) =>
      tx.um('SELECT substituir_em_campo($1, $2, $3) AS nova_alocacao_id', [id, dto.substituto_id, dto.motivo]));
  }

  @Get('eventos/:id/ocorrencias')
  @Requer('M6', 'ver')
  ocorrencias(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      await garantirAcessoEvento(tx, u, id);
      return tx.q(
        `SELECT o.*, pr.nome AS profissional, us.nome AS registrado_por_nome
           FROM ocorrencia o
           LEFT JOIN alocacao a ON a.id = o.alocacao_id LEFT JOIN profissional pr ON pr.id = a.profissional_id
           LEFT JOIN usuario us ON us.id = o.registrado_por
          WHERE o.evento_id = $1 ORDER BY o.registrado_em DESC`, [id]);
    });
  }

  @Post('eventos/:id/ocorrencias')
  @Requer('M6', 'criar')
  novaOcorrencia(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string,
                 @Body(new Validar(Ocorrencia)) dto: z.infer<typeof Ocorrencia>) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      await garantirAcessoEvento(tx, u, id);
      return tx.um(
        `INSERT INTO ocorrencia (evento_id, alocacao_id, tipo, gravidade, descricao, fotos, registrado_por)
         VALUES ($1, $2, $3, $4, $5, $6, app_usuario()) RETURNING *`,
        [id, dto.alocacao_id ?? null, dto.tipo, dto.gravidade, dto.descricao, dto.fotos]);
    });
  }
}
