import { Controller, ForbiddenException, Get, Injectable, Logger, OnModuleDestroy, OnModuleInit, Param, Post, Req, ServiceUnavailableException, Inject } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { DbService, ContextoDb } from '../db/db.service';
import { Ctx, Requer, Usuario, UsuarioLogado } from '../auth/decorators';
import { config } from '../config';

/**
 * BI desde o início. Duas formas de consumo:
 *  1) /bi/indicadores — números prontos para o painel do próprio sistema
 *  2) /bi/embed/:dashboard — painel do Metabase embutido, com a empresa travada no token
 *     (o usuário não consegue trocar o filtro e ver dados de outra empresa)
 */
@Controller('bi')
export class BiController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get('indicadores')
  @Requer('BI', 'ver')
  async indicadores(@Ctx() ctx: ContextoDb, @Req() req: any) {
    const verValores = await req.pode('BI', 'ver_valores');
    return this.db.tx(ctx, async (tx) => {
      const mensal = await tx.q(
        `SELECT * FROM analytics.kpi_mensal WHERE tenant_id = app_tenant() ORDER BY ano_mes DESC LIMIT 12`);
      const clientes = verValores
        ? await tx.q(`SELECT cliente, eventos, receita, margem, margem_pct, ultimo_evento FROM analytics.kpi_cliente
                       WHERE tenant_id = app_tenant() ORDER BY receita DESC NULLS LAST LIMIT 10`)
        : [];
      const ocupacao = await tx.q(
        `SELECT * FROM analytics.kpi_ocupacao_base WHERE tenant_id = app_tenant() ORDER BY ano_mes DESC LIMIT 12`);
      const profissionais = await tx.q(
        `SELECT k.*, p.nome FROM analytics.kpi_profissional k JOIN profissional p ON p.id = k.profissional_id
          WHERE k.tenant_id = app_tenant() AND k.jobs > 0
          ORDER BY k.assiduidade_pct DESC NULLS LAST, k.nota_media DESC NULLS LAST LIMIT 20`);
      const ultimaAtualizacao = await tx.um('SELECT max(concluido_em) AS em FROM analytics.atualizacao_log');
      const ocultar = (linhas: any[]) => verValores ? linhas
        : linhas.map(({ receita, custo_equipe, custos_diretos, margem, margem_pct, total_recebido, ...r }) => r);
      return {
        atualizado_em: ultimaAtualizacao?.em,
        mensal: ocultar(mensal),
        clientes,
        ocupacao,
        profissionais: ocultar(profissionais),
      };
    });
  }

  @Post('atualizar')
  @Requer('BI', 'ver')
  async atualizar(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb) {
    if (u.perfil !== 'admin') throw new ForbiddenException({ codigo: 'somente_admin' });
    const ini = Date.now();
    await this.db.tx(ctx, (tx) => tx.q('SELECT analytics.atualizar(true)'));
    return { ok: true, duracao_ms: Date.now() - ini };
  }

  /** URL assinada para embutir um painel do Metabase com a empresa travada */
  @Get('embed/:dashboard')
  @Requer('BI', 'ver')
  async embed(@Usuario() u: UsuarioLogado, @Param('dashboard') dashboard: string, @Req() req: any) {
    if (!config.metabaseUrl || !config.metabaseEmbedSegredo) {
      throw new ServiceUnavailableException({ codigo: 'bi_nao_configurado', mensagem: 'Metabase não configurado.' });
    }
    const verValores = await req.pode('BI', 'ver_valores');
    const token = jwt.sign(
      {
        resource: { dashboard: Number(dashboard) },
        // parâmetros "locked" no Metabase: a empresa e se pode ver valores
        params: { tenant_id: u.tenantId, ver_valores: verValores ? 'sim' : 'nao' },
        exp: Math.round(Date.now() / 1000) + 10 * 60,
      },
      config.metabaseEmbedSegredo,
    );
    return { url: `${config.metabaseUrl}/embed/dashboard/${token}#bordered=false&titled=false` };
  }
}

/** Atualiza a camada analítica periodicamente (Fase 1: a cada hora; ajustável por variável). */
@Injectable()
export class BiAgendador implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('BI');
  private timer?: NodeJS.Timeout;
  constructor(@Inject(DbService) private readonly db: DbService) {}

  onModuleInit() {
    // Na Vercel a API roda como função: não fica viva entre requisições para um timer disparar.
    // Lá a atualização é feita pelo botão do BI (POST /api/bi/atualizar) ou por um agendamento externo.
    if (!config.biIntervaloMin || process.env.VERCEL) return;
    this.timer = setInterval(() => this.rodar(), config.biIntervaloMin * 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async rodar() {
    try {
      // advisory lock: com várias instâncias da API, só uma atualiza
      await this.db.tx({}, async (tx) => {
        const lock = await tx.um<{ ok: boolean }>('SELECT pg_try_advisory_xact_lock(424242) AS ok');
        if (lock?.ok) await tx.q('SELECT analytics.atualizar(true)');
      });
      this.log.log('Camada analítica atualizada');
    } catch (e: any) {
      this.log.error(`Falha ao atualizar BI: ${e.message}`);
    }
  }
}
