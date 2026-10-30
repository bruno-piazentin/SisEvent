import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { DbService, ContextoDb } from '../db/db.service';
import { Validar, uuid } from '../comum/validacao';
import { Ctx, Requer, Usuario, UsuarioLogado } from '../auth/decorators';
import { garantirAcessoEvento } from '../eventos/escopo';

const NovaAlocacao = z.object({
  profissional_id: uuid,
  tipo: z.enum(['titular', 'suplente']).default('titular'),
  confirmar_direto: z.boolean().default(false),   // quando a central já confirmou por telefone
});
const AtualizarAlocacao = z.object({
  status: z.enum(['convidado', 'confirmado', 'recusado', 'cancelado']),
  motivo: z.string().max(500).nullish(),
});

/** M5 — Escala e alocação, com o cruzamento profissional × posto */
@Controller()
export class EscalaController {
  constructor(private readonly db: DbService) {}

  /** Ranking de candidatos para o posto, com motivos e alertas */
  @Get('postos/:id/sugestoes')
  @Requer('M5', 'ver')
  sugestoes(@Ctx() ctx: ContextoDb, @Param('id') id: string,
            @Query(new Validar(z.object({ limite: z.coerce.number().int().min(1).max(200).default(30),
                                          incluir_em_teste: z.coerce.boolean().default(true) })))
            q: { limite: number; incluir_em_teste: boolean }) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) => tx.q('SELECT * FROM sugerir_profissionais($1, $2, $3)', [id, q.limite, q.incluir_em_teste]));
  }

  /** "Tenho N promotores livres em Maringá no sábado?" */
  @Get('disponiveis')
  @Requer('M1', 'ver')
  disponiveis(@Ctx() ctx: ContextoDb,
              @Query(new Validar(z.object({ funcao: uuid, praca: uuid, inicio: z.coerce.date(), fim: z.coerce.date() })))
              q: { funcao: string; praca: string; inicio: Date; fim: Date }) {
    return this.db.tx(ctx, async (tx) => {
      const itens = await tx.q('SELECT * FROM profissionais_livres(app_tenant(), $1, $2, $3, $4)', [q.funcao, q.praca, q.inicio, q.fim]);
      return { total: itens.length, disponibilidade_total: itens.filter((i) => i.disponibilidade === 'total').length, itens };
    });
  }

  @Get('eventos/:id/escala')
  @Requer('M5', 'ver')
  escala(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      await garantirAcessoEvento(tx, u, id);
      return tx.q(
        `SELECT a.id, a.posto_id, a.tipo, a.status, a.convidado_em, a.respondido_em, a.motivo,
                t.id AS turno_id, t.nome AS turno, t.inicio, t.fim, f.nome AS funcao,
                pr.id AS profissional_id, pr.nome AS profissional, pr.celular, pr.foto_url,
                ap.status AS presenca, ap.checkin_em, ap.checkout_em, ap.atraso_min, ap.suspeito, ap.checkin_metodo
           FROM alocacao a
           JOIN posto p ON p.id = a.posto_id
           JOIN turno t ON t.id = p.turno_id
           JOIN funcao f ON f.id = p.funcao_id
           JOIN profissional pr ON pr.id = a.profissional_id
           LEFT JOIN apontamento ap ON ap.alocacao_id = a.id
          WHERE t.evento_id = $1
          ORDER BY t.inicio, f.nome, a.tipo, pr.nome`, [id]);
    });
  }

  /**
   * Escala um profissional no posto. Conflito de horário e lotação são barrados pelo banco
   * (erros 409 conflito_horario / posto_lotado), então nenhuma tela consegue furar a regra.
   */
  @Post('postos/:id/alocacoes')
  @Requer('M5', 'criar')
  alocar(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(NovaAlocacao)) dto: z.infer<typeof NovaAlocacao>) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) =>
      tx.um(
        `INSERT INTO alocacao (posto_id, profissional_id, tipo, status, criado_por, respondido_em)
         VALUES ($1, $2, $3::tipo_alocacao, $4::status_alocacao, app_usuario(), CASE WHEN $4::status_alocacao = 'confirmado' THEN now() END)
         RETURNING id, status, tipo`,
        [id, dto.profissional_id, dto.tipo, dto.confirmar_direto ? 'confirmado' : 'convidado'],
      ),
    );
  }

  /** Alocar vários de uma vez (ex.: os 4 primeiros da lista de sugestões) — tudo ou nada */
  @Post('postos/:id/alocacoes/lote')
  @Requer('M5', 'criar')
  alocarLote(@Ctx() ctx: ContextoDb, @Param('id') id: string,
             @Body(new Validar(z.object({ profissionais: z.array(uuid).min(1).max(100) }))) dto: { profissionais: string[] }) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const criadas: unknown[] = [];
      for (const p of dto.profissionais) {
        criadas.push(await tx.um(
          `INSERT INTO alocacao (posto_id, profissional_id, criado_por) VALUES ($1, $2, app_usuario()) RETURNING id, profissional_id`,
          [id, p]));
      }
      return criadas;
    });
  }

  @Patch('alocacoes/:id')
  @Requer('M5', 'editar')
  atualizar(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(AtualizarAlocacao)) dto: z.infer<typeof AtualizarAlocacao>) {
    uuid.parse(id);
    // o motivo também vai para a auditoria via app.motivo
    return this.db.tx({ ...ctx, motivo: dto.motivo ?? ctx.motivo }, async (tx) => {
      const r = await tx.um(
        `UPDATE alocacao SET status = $2::status_alocacao, motivo = COALESCE($3, motivo),
                respondido_em = CASE WHEN $2 IN ('confirmado','recusado') THEN now() ELSE respondido_em END
          WHERE id = $1 RETURNING id, status`, [id, dto.status, dto.motivo ?? null]);
      if (!r) throw new NotFoundException();
      return r;
    });
  }

  /** Promove suplente a titular (ex.: titular recusou) */
  @Post('alocacoes/:id/promover')
  @Requer('M5', 'editar')
  promover(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx({ ...ctx, motivo: 'suplente promovido a titular' }, (tx) =>
      tx.um(`UPDATE alocacao SET tipo = 'titular' WHERE id = $1 AND tipo = 'suplente' RETURNING id, tipo, status`, [id]));
  }

  @Get('eventos/:id/historico-escala')
  @Requer('M5', 'ver')
  historico(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) => tx.q('SELECT * FROM vw_historico_escala WHERE evento_id = $1 ORDER BY em DESC LIMIT 500', [id]));
  }
}
