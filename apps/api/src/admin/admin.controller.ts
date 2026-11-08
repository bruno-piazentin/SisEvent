import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Inject } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { DbService, ContextoDb } from '../db/db.service';
import { Validar, uuid } from '../comum/validacao';
import { Ctx, Usuario, UsuarioLogado } from '../auth/decorators';
import { config } from '../config';
import { dataUrlImagemValida } from '../comum/imagem';

export const MODULOS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9', 'BI'] as const;
const ACOES = ['ver', 'criar', 'editar', 'excluir', 'aprovar', 'ver_valores'] as const;
// DP (dados pessoais) só existe como permissão: não é contratado nem tem tela
const MODULOS_PERMISSAO = [...MODULOS, 'DP'] as const;

const LiberarModulo = z.object({ ativo: z.boolean(), expira_em: z.coerce.date().nullable().optional() });
const PermissoesPerfil = z.object({
  permissoes: z.array(z.object({ modulo: z.enum(MODULOS_PERMISSAO), acao: z.enum(ACOES) })),
});
const AjusteUsuario = z.object({
  modulo: z.enum(MODULOS_PERMISSAO),
  acao: z.enum(ACOES),
  concedido: z.boolean().nullable(), // null remove o ajuste e volta a valer o perfil
});
const NovoUsuario = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  perfil: z.enum(['admin', 'central', 'supervisor', 'financeiro']),
  senha: z.string().min(8),
});
const EditarUsuario = z.object({
  nome: z.string().trim().min(2).optional(),
  perfil: z.enum(['admin', 'central', 'supervisor', 'financeiro']).optional(),
  ativo: z.boolean().optional(),
  senha: z.string().min(8).optional(),
});
// data URL já reduzida no navegador; null remove o logo (volta a mostrar as iniciais)
export const Logo = z.object({
  logo: z.string().max(300_000, 'O logo deve ter até 220 KB.')
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Envie o logo em PNG, JPG ou WEBP.')
    .refine(dataUrlImagemValida, 'O arquivo não é uma imagem PNG, JPG ou WEBP válida.').nullable(),
});

/**
 * Administração da liberação por módulos (somente perfil Administradora).
 * Camada 1: módulos da empresa · Camada 2: perfil × módulo × ação · Camada 3: ajuste por usuário.
 */
@Controller('admin')
export class AdminController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  private exigirAdmin(u: UsuarioLogado) {
    if (u.perfil !== 'admin') throw new ForbiddenException({ codigo: 'somente_admin' });
  }

  /** O usuário master de manutenção não é alterado pela empresa (um bloqueio individual tiraria o acesso dele) */
  private async protegerMaster(tx: any, id: string) {
    const alvo = await tx.um('SELECT email FROM usuario WHERE id = $1', [id]);
    if (!alvo) throw new NotFoundException({ codigo: 'nao_encontrado', mensagem: 'Usuário não encontrado.' });
    if (config.master && String(alvo.email).toLowerCase() === config.master.email) {
      throw new ForbiddenException({ codigo: 'usuario_master', mensagem: 'O usuário de manutenção do Cachet não pode ser alterado.' });
    }
  }

  @Get('modulos')
  modulos(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb) {
    this.exigirAdmin(u);
    return this.db.tx(ctx, (tx) =>
      tx.q(
        `SELECT m.codigo, m.nome, m.descricao, m.fase, m.codigo = 'DP' AS so_permissao,
                COALESCE(ml.ativo, false) AND (ml.expira_em IS NULL OR ml.expira_em > now()) AS liberado,
                ml.liberado_em, ml.expira_em
           FROM modulo m LEFT JOIN modulo_liberado ml ON ml.modulo = m.codigo AND ml.tenant_id = app_tenant()
          ORDER BY m.ordem`,
      ),
    );
  }

  @Put('modulos/:codigo')
  liberar(
    @Usuario() u: UsuarioLogado,
    @Ctx() ctx: ContextoDb,
    @Param('codigo') codigo: string,
    @Body(new Validar(LiberarModulo)) dto: z.infer<typeof LiberarModulo>,
  ) {
    // os módulos seguem o contrato com o Cachet: a empresa não libera para si o que não contratou
    if (!u.master) throw new ForbiddenException({ codigo: 'somente_master', mensagem: 'A liberação de módulos é feita pelo Cachet, conforme o contrato da empresa.' });
    z.enum(MODULOS).parse(codigo);
    return this.db.tx(ctx, (tx) =>
      tx.um(
        `INSERT INTO modulo_liberado (tenant_id, modulo, ativo, expira_em) VALUES (app_tenant(), $1, $2, $3)
         ON CONFLICT (tenant_id, modulo) DO UPDATE SET ativo = EXCLUDED.ativo, expira_em = EXCLUDED.expira_em,
                liberado_em = CASE WHEN EXCLUDED.ativo AND NOT modulo_liberado.ativo THEN now() ELSE modulo_liberado.liberado_em END
         RETURNING *`,
        [codigo, dto.ativo, dto.expira_em ?? null],
      ),
    );
  }

  @Get('perfis')
  perfis(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb) {
    this.exigirAdmin(u);
    return this.db.tx(ctx, (tx) =>
      tx.q(
        `SELECT p.id, p.codigo, p.nome, p.acesso_total,
                COALESCE(jsonb_agg(jsonb_build_object('modulo', pp.modulo, 'acao', pp.acao)
                         ORDER BY pp.modulo, pp.acao) FILTER (WHERE pp.modulo IS NOT NULL), '[]') AS permissoes
           FROM perfil_acesso p LEFT JOIN perfil_permissao pp ON pp.perfil_id = p.id
          GROUP BY p.id ORDER BY p.acesso_total DESC, p.nome`,
      ),
    );
  }

  /** Substitui a matriz de permissões de um perfil */
  @Put('perfis/:id/permissoes')
  permissoesPerfil(
    @Usuario() u: UsuarioLogado,
    @Ctx() ctx: ContextoDb,
    @Param('id') id: string,
    @Body(new Validar(PermissoesPerfil)) dto: z.infer<typeof PermissoesPerfil>,
  ) {
    this.exigirAdmin(u);
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      await tx.q('DELETE FROM perfil_permissao WHERE perfil_id = $1', [id]);
      if (dto.permissoes.length) {
        await tx.q(
          `INSERT INTO perfil_permissao (perfil_id, modulo, acao)
           SELECT $1, x.modulo, x.acao::acao_permissao
             FROM jsonb_to_recordset($2::jsonb) AS x(modulo text, acao text)`,
          [id, JSON.stringify(dto.permissoes)],
        );
      }
      return { ok: true, total: dto.permissoes.length };
    });
  }

  /** Logo da empresa: aparece no menu do painel e na área do profissional */
  @Put('logo')
  async logo(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb, @Body(new Validar(Logo)) dto: z.infer<typeof Logo>) {
    this.exigirAdmin(u);
    await this.db.tx(ctx, (tx) => tx.q('UPDATE tenant SET logo = $1 WHERE id = app_tenant()', [dto.logo]));
    return { ok: true };
  }

  @Get('usuarios')
  usuarios(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb) {
    this.exigirAdmin(u);
    return this.db.tx(ctx, (tx) =>
      tx.q(
        `SELECT us.id, us.nome, us.email, us.ativo, us.ultimo_acesso, p.codigo AS perfil, lower(us.email) = $1 AS master,
                COALESCE(jsonb_agg(jsonb_build_object('modulo', up.modulo, 'acao', up.acao, 'concedido', up.concedido))
                         FILTER (WHERE up.modulo IS NOT NULL), '[]') AS ajustes
           FROM usuario us JOIN perfil_acesso p ON p.id = us.perfil_id
           LEFT JOIN usuario_permissao up ON up.usuario_id = us.id
          GROUP BY us.id, p.codigo ORDER BY us.ativo DESC, us.nome`,
        [config.master?.email ?? null],
      ),
    );
  }

  /** Muda nome, perfil, situação ou redefine a senha de um usuário da empresa */
  @Put('usuarios/:id')
  async editarUsuario(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb, @Param('id') id: string,
                      @Body(new Validar(EditarUsuario)) dto: z.infer<typeof EditarUsuario>) {
    this.exigirAdmin(u);
    uuid.parse(id);
    // a administradora não se tranca para fora
    if (id === u.id && (dto.ativo === false || (dto.perfil && dto.perfil !== 'admin'))) {
      throw new ForbiddenException({ codigo: 'proprio_usuario', mensagem: 'Você não pode inativar nem mudar o perfil do seu próprio usuário.' });
    }
    const hash = dto.senha ? await bcrypt.hash(dto.senha, 10) : null;
    return this.db.tx(ctx, async (tx) => {
      await this.protegerMaster(tx, id);
      return tx.um(
        `UPDATE usuario SET nome = COALESCE($2, nome),
                perfil_id = COALESCE((SELECT id FROM perfil_acesso WHERE codigo = $3), perfil_id),
                ativo = COALESCE($4, ativo),
                senha_hash = COALESCE($5, senha_hash),
                sessoes_desde = CASE WHEN $5 IS NOT NULL OR $4 IS FALSE THEN now() ELSE sessoes_desde END   -- derruba as sessões abertas
          WHERE id = $1
         RETURNING id, nome, email, ativo`,
        [id, dto.nome ?? null, dto.perfil ?? null, dto.ativo ?? null, hash],
      );
    });
  }

  @Post('usuarios')
  async criarUsuario(
    @Usuario() u: UsuarioLogado,
    @Ctx() ctx: ContextoDb,
    @Body(new Validar(NovoUsuario)) dto: z.infer<typeof NovoUsuario>,
  ) {
    this.exigirAdmin(u);
    const hash = await bcrypt.hash(dto.senha, 10);
    return this.db.tx(ctx, (tx) =>
      tx.um(
        `INSERT INTO usuario (perfil_id, nome, email, senha_hash)
         SELECT id, $2, $3, $4 FROM perfil_acesso WHERE codigo = $1
         RETURNING id, nome, email`,
        [dto.perfil, dto.nome, dto.email, hash],
      ),
    );
  }

  /** Camada 3: concede ou bloqueia algo para uma pessoa específica */
  @Put('usuarios/:id/ajustes')
  ajuste(
    @Usuario() u: UsuarioLogado,
    @Ctx() ctx: ContextoDb,
    @Param('id') id: string,
    @Body(new Validar(AjusteUsuario)) dto: z.infer<typeof AjusteUsuario>,
  ) {
    this.exigirAdmin(u);
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      await this.protegerMaster(tx, id);
      if (dto.concedido === null) {
        await tx.q('DELETE FROM usuario_permissao WHERE usuario_id = $1 AND modulo = $2 AND acao = $3', [
          id, dto.modulo, dto.acao,
        ]);
      } else {
        await tx.q(
          `INSERT INTO usuario_permissao (usuario_id, modulo, acao, concedido) VALUES ($1, $2, $3, $4)
           ON CONFLICT (usuario_id, modulo, acao) DO UPDATE SET concedido = EXCLUDED.concedido`,
          [id, dto.modulo, dto.acao, dto.concedido],
        );
      }
      return tx.q('SELECT modulo, nome, acoes::text[] AS acoes FROM vw_menu_usuario WHERE usuario_id = $1 ORDER BY ordem', [id]);
    });
  }

  /** Histórico de qualquer registro (auditoria) */
  @Get('auditoria/:tabela/:id')
  auditoria(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb, @Param('tabela') tabela: string, @Param('id') id: string) {
    this.exigirAdmin(u);
    uuid.parse(id);
    return this.db.tx(ctx, (tx) =>
      tx.q(
        `SELECT a.em, a.operacao, a.motivo, a.alterado, a.antes, us.nome AS usuario
           FROM auditoria a LEFT JOIN usuario us ON us.id = a.usuario_id
          WHERE a.tabela = $1 AND a.registro_id = $2 ORDER BY a.em DESC LIMIT 200`,
        [tabela, id],
      ),
    );
  }
}
