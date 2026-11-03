import { Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, Req, Inject } from '@nestjs/common';
import { z } from 'zod';
import { DbService, ContextoDb } from '../db/db.service';
import { Validar, uuid, dinheiro } from '../comum/validacao';
import { Ctx, Requer, Usuario, UsuarioLogado } from '../auth/decorators';
import { decifrar } from '../comum/cripto';

/** M7 — Custo, fechamento, pagamento ao profissional, faturamento e margem */
@Controller()
export class FinanceiroController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /** O que impede o fechamento (vagas abertas sem justificativa, convites sem resposta, checkout pendente) */
  @Get('eventos/:id/pendencias')
  @Requer('M7', 'ver')
  pendencias(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) => tx.q('SELECT * FROM pendencias_fechamento($1)', [id]));
  }

  /** Critérios de aceite 1 e 3: valida pendências, calcula custos, gera pagamentos, fatura e margem */
  @Post('eventos/:id/fechar')
  @Requer('M7', 'aprovar')
  fechar(@Ctx() ctx: ContextoDb, @Param('id') id: string,
         @Body(new Validar(z.object({ aceitar_checkout_pendente: z.boolean().default(false) }))) dto: { aceitar_checkout_pendente: boolean }) {
    uuid.parse(id);
    return this.db.tx({ ...ctx, motivo: 'fechamento do evento' }, (tx) =>
      tx.um('SELECT fechar_evento($1, $2) AS r', [id, dto.aceitar_checkout_pendente])).then((x) => x!.r);
  }

  @Post('eventos/:id/reabrir')
  @Requer('M7', 'aprovar')
  reabrir(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string,
          @Body(new Validar(z.object({ motivo: z.string().min(10) }))) dto: { motivo: string }) {
    if (u.perfil !== 'admin') throw new ForbiddenException({ codigo: 'somente_admin', mensagem: 'Só a administradora reabre evento fechado.' });
    uuid.parse(id);
    return this.db.tx({ ...ctx, motivo: dto.motivo }, (tx) => tx.q('SELECT reabrir_evento($1, $2)', [id, dto.motivo])).then(() => ({ ok: true }));
  }

  /** Detalhe do fechamento: custo por profissional (com memória de cálculo), fatura e margem */
  @Get('eventos/:id/fechamento')
  @Requer('M7', 'ver')
  async fechamento(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Req() req: any) {
    uuid.parse(id);
    const verValores = await req.pode('M7', 'ver_valores');
    return this.db.tx(ctx, async (tx) => {
      const custos = await tx.q(
        `SELECT c.*, pr.nome AS profissional FROM custo_alocacao c JOIN profissional pr ON pr.id = c.profissional_id
          WHERE c.evento_id = $1 ORDER BY pr.nome`, [id]);
      const pagamentos = await tx.q(
        `SELECT pg.*, pr.nome AS profissional FROM pagamento_profissional pg JOIN profissional pr ON pr.id = pg.profissional_id
          WHERE pg.evento_id = $1 ORDER BY pr.nome`, [id]);
      const fatura = await tx.um('SELECT * FROM fatura_cliente WHERE evento_id = $1', [id]);
      const margem = verValores ? await tx.um('SELECT * FROM vw_margem_evento WHERE evento_id = $1', [id]) : undefined;
      return { custos, pagamentos, fatura, margem };
    });
  }

  @Post('alocacoes/:id/lancamentos')
  @Requer('M7', 'criar')
  lancamento(@Ctx() ctx: ContextoDb, @Param('id') id: string,
             @Body(new Validar(z.object({
               tipo: z.enum(['deslocamento', 'ajuda_custo', 'alimentacao', 'bonus', 'desconto', 'outro']),
               valor: z.coerce.number(), repassa_cliente: z.boolean().default(false), descricao: z.string().nullish(),
             }))) dto: { tipo: string; valor: number; repassa_cliente: boolean; descricao?: string | null }) {
    uuid.parse(id);
    const valor = dto.tipo === 'desconto' ? -Math.abs(dto.valor) : dto.valor;
    return this.db.tx(ctx, (tx) =>
      tx.um(`INSERT INTO lancamento_adicional (alocacao_id, tipo, valor, repassa_cliente, descricao, criado_por)
             VALUES ($1, $2, $3, $4, $5, app_usuario()) RETURNING *`,
        [id, dto.tipo, valor, dto.repassa_cliente, dto.descricao ?? null]));
  }

  @Post('eventos/:id/custos-diretos')
  @Requer('M7', 'criar')
  custoDireto(@Ctx() ctx: ContextoDb, @Param('id') id: string,
              @Body(new Validar(z.object({ descricao: z.string(), valor: dinheiro, fornecedor_id: uuid.nullish(),
                                           repassa_cliente: z.boolean().default(false), vencimento: z.coerce.date().nullish() })))
              dto: { descricao: string; valor: number; fornecedor_id?: string | null; repassa_cliente: boolean; vencimento?: Date | null }) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) =>
      tx.um(`INSERT INTO custo_direto (evento_id, fornecedor_id, descricao, valor, repassa_cliente, vencimento)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [id, dto.fornecedor_id ?? null, dto.descricao, dto.valor, dto.repassa_cliente, dto.vencimento ?? null]));
  }

  /** Contas a pagar de freelancer */
  @Get('pagamentos')
  @Requer('M7', 'ver')
  async pagamentos(@Ctx() ctx: ContextoDb, @Req() req: any, @Query(new Validar(z.object({ status: z.string().optional() }))) q: { status?: string }) {
    const verDadosPessoais = await req.podeDadosPessoais();
    const itens = await this.db.tx(ctx, (tx) =>
      tx.q(`SELECT pg.id, pg.valor, pg.status, pg.chave_pix, pg.pago_em, pg.lote_id, pr.nome AS profissional,
                   pr.forma_contratacao, e.nome AS evento, (SELECT min(inicio) FROM turno WHERE evento_id = e.id) AS data_evento
              FROM pagamento_profissional pg JOIN profissional pr ON pr.id = pg.profissional_id JOIN evento e ON e.id = pg.evento_id
             WHERE ($1::text IS NULL OR pg.status::text = $1)
             ORDER BY data_evento DESC, pr.nome`, [q.status ?? null]));
    // chave PIX é dado pessoal (permissão DP): sem ela o campo não vem
    for (const i of itens) if (verDadosPessoais) i.chave_pix = decifrar(i.chave_pix); else delete i.chave_pix;
    return itens;
  }

  /** Lote de pagamento (PIX em lote): agrupa pendentes e devolve CSV pronto para o banco */
  @Post('lotes-pagamento')
  @Requer('M7', 'aprovar')
  async lote(@Ctx() ctx: ContextoDb, @Req() req: any,
       @Body(new Validar(z.object({ descricao: z.string(), data_prevista: z.coerce.date(), pagamentos: z.array(uuid).min(1) })))
       dto: { descricao: string; data_prevista: Date; pagamentos: string[] }) {
    // o arquivo do banco leva CPF e chave PIX
    if (!(await req.podeDadosPessoais())) {
      throw new ForbiddenException({ codigo: 'sem_dados_pessoais', mensagem: 'O lote de pagamento leva CPF e chave PIX: é preciso a permissão "Dados pessoais".' });
    }
    return this.db.tx(ctx, async (tx) => {
      const lote = await tx.um<{ id: string }>(
        'INSERT INTO lote_pagamento (descricao, data_prevista, criado_por) VALUES ($1, $2, app_usuario()) RETURNING id',
        [dto.descricao, dto.data_prevista]);
      const itens = await tx.q(
        `UPDATE pagamento_profissional pg SET lote_id = $1, status = 'em_lote'
           FROM profissional pr
          WHERE pg.id = ANY($2::uuid[]) AND pg.status = 'pendente' AND pr.id = pg.profissional_id
          RETURNING pr.nome, pr.cpf, pg.chave_pix, pg.valor`, [lote!.id, dto.pagamentos]);
      const csv = ['nome;cpf;chave_pix;valor', ...itens.map((i) => `${i.nome};${decifrar(i.cpf) ?? ''};${decifrar(i.chave_pix) ?? ''};${Number(i.valor).toFixed(2).replace('.', ',')}`)].join('\n');
      return { lote_id: lote!.id, quantidade: itens.length, total: itens.reduce((s, i) => s + Number(i.valor), 0), csv };
    });
  }

  @Patch('pagamentos/:id')
  @Requer('M7', 'editar')
  marcarPago(@Ctx() ctx: ContextoDb, @Param('id') id: string,
             @Body(new Validar(z.object({ status: z.enum(['pago', 'cancelado']), comprovante_url: z.string().url().nullish() })))
             dto: { status: 'pago' | 'cancelado'; comprovante_url?: string | null }) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) =>
      tx.um(`UPDATE pagamento_profissional SET status = $2::status_pagamento, comprovante_url = COALESCE($3, comprovante_url),
                    pago_em = CASE WHEN $2 = 'pago' THEN now() END
              WHERE id = $1 RETURNING *`, [id, dto.status, dto.comprovante_url ?? null]));
  }

  /** Contas a receber: faturas por status e vencidas */
  @Get('faturas')
  @Requer('M7', 'ver_valores')
  faturas(@Ctx() ctx: ContextoDb) {
    return this.db.tx(ctx, (tx) =>
      tx.q(`SELECT f.*, e.nome AS evento, COALESCE(c.nome_fantasia, c.razao_social) AS cliente,
                   (f.status <> 'recebida' AND f.vencimento < current_date) AS vencida
              FROM fatura_cliente f JOIN evento e ON e.id = f.evento_id JOIN cliente c ON c.id = f.cliente_id
             ORDER BY f.vencimento`));
  }

  /** Margem por evento e por cliente/marca — o que a dona do negócio mais quer ver */
  @Get('margem')
  @Requer('M7', 'ver_valores')
  margem(@Ctx() ctx: ContextoDb, @Query(new Validar(z.object({ de: z.coerce.date().optional(), ate: z.coerce.date().optional() })))
         q: { de?: Date; ate?: Date }) {
    return this.db.tx(ctx, async (tx) => {
      const eventos = await tx.q(
        `SELECT *, receita - custo_equipe - custos_diretos AS margem,
                round(100 * (receita - custo_equipe - custos_diretos) / NULLIF(receita, 0), 2) AS margem_pct
           FROM vw_margem_evento
          WHERE status <> 'cancelado' AND ($1::timestamptz IS NULL OR inicio >= $1) AND ($2::timestamptz IS NULL OR inicio <= $2)
          ORDER BY inicio DESC`, [q.de ?? null, q.ate ?? null]);
      const porCliente = Object.values(eventos.reduce((acc: Record<string, any>, e) => {
        const c = (acc[e.cliente_id] ??= { cliente: e.cliente, eventos: 0, receita: 0, margem: 0 });
        c.eventos++; c.receita += Number(e.receita ?? 0); c.margem += Number(e.margem ?? 0);
        return acc;
      }, {})).map((c: any) => ({ ...c, margem_pct: c.receita ? Math.round((10000 * c.margem) / c.receita) / 100 : null }));
      return { eventos, por_cliente: porCliente };
    });
  }
}
