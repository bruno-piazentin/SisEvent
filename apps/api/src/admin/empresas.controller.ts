import { Body, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { DbService, ContextoDb, Tx } from '../db/db.service';
import { Validar, uuid } from '../comum/validacao';
import { Usuario, UsuarioLogado } from '../auth/decorators';
import { MODULOS } from './admin.controller';

const PERFIS = ['admin', 'central', 'supervisor', 'financeiro'] as const;

/** Empresa nova com perfis padrão, módulos e regra de custo. Rodar no contexto da própria empresa (RLS). */
export async function criarEmpresa(tx: Tx, id: string, nome: string, slug: string, modulos: readonly string[]) {
  await tx.q('INSERT INTO tenant (id, nome, slug) VALUES ($1, $2, $3)', [id, nome, slug]);
  await tx.q('SELECT criar_perfis_padrao($1)', [id]);
  await tx.q('INSERT INTO modulo_liberado (tenant_id, modulo) SELECT $1, unnest($2::text[])', [id, modulos]);
  await tx.q('INSERT INTO regra_custo (tenant_id) VALUES ($1)', [id]);
}

const NovaEmpresa = z.object({
  nome: z.string().trim().min(2),
  // código usado no login; só minúsculas, números e hífen
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Use de 2 a 40 letras minúsculas, números ou hífen.'),
  modulos: z.array(z.enum(MODULOS)).min(1, 'Libere pelo menos um módulo.'),
  admin: z.object({
    nome: z.string().trim().min(2),
    email: z.string().trim().email(),
    senha: z.string().min(8),
  }),
});
const EditarEmpresa = z.object({ nome: z.string().trim().min(2).optional(), ativo: z.boolean().optional() });
const NovoUsuario = z.object({
  nome: z.string().trim().min(2),
  email: z.string().trim().email(),
  perfil: z.enum(PERFIS),
  senha: z.string().min(8),
});
const EditarUsuario = z.object({
  nome: z.string().trim().min(2).optional(),
  perfil: z.enum(PERFIS).optional(),
  ativo: z.boolean().optional(),
  senha: z.string().min(8).optional(),
});

/**
 * Cadastro de empresas da plataforma (somente o usuário master).
 * Todas as escritas rodam no contexto da empresa alvo, então o RLS continua valendo:
 * o que é gravado aqui pertence só àquela empresa.
 */
@Controller('empresas')
export class EmpresasController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  private exigirMaster(u: UsuarioLogado) {
    if (!u.master) throw new ForbiddenException({ codigo: 'somente_master', mensagem: 'Somente o usuário master acessa o cadastro de empresas.' });
  }

  /** Contexto da empresa alvo, com o master como autor na auditoria */
  private ctx(u: UsuarioLogado, empresaId: string): ContextoDb {
    return { tenantId: empresaId, usuarioId: u.id, motivo: `Plataforma (${u.nome})` };
  }

  @Get()
  listar(@Usuario() u: UsuarioLogado) {
    this.exigirMaster(u);
    return this.db.tx({}, (tx) => tx.q('SELECT * FROM listar_empresas()'));
  }

  /** Cria a empresa com perfis padrão, módulos liberados, regra de custo e a primeira administradora */
  @Post()
  async criar(@Usuario() u: UsuarioLogado, @Body(new Validar(NovaEmpresa)) dto: z.infer<typeof NovaEmpresa>) {
    this.exigirMaster(u);
    const id = randomUUID();
    const hash = await bcrypt.hash(dto.admin.senha, 10);
    return this.db.tx(this.ctx(u, id), async (tx) => {
      await criarEmpresa(tx, id, dto.nome, dto.slug, dto.modulos);
      await tx.q(
        `INSERT INTO usuario (perfil_id, nome, email, senha_hash)
         SELECT id, $1, $2, $3 FROM perfil_acesso WHERE codigo = 'admin'`,
        [dto.admin.nome, dto.admin.email, hash],
      );
      return { id, nome: dto.nome, slug: dto.slug };
    });
  }

  @Put(':id')
  async editar(@Usuario() u: UsuarioLogado, @Param('id') id: string, @Body(new Validar(EditarEmpresa)) dto: z.infer<typeof EditarEmpresa>) {
    this.exigirMaster(u);
    uuid.parse(id);
    if (dto.ativo === false && id === u.tenantId) {
      throw new ForbiddenException({ codigo: 'propria_empresa', mensagem: 'Não é possível inativar a empresa em que você está logado.' });
    }
    const r = await this.db.tx(this.ctx(u, id), (tx) =>
      tx.um(
        `UPDATE tenant SET nome = COALESCE($2, nome), ativo = COALESCE($3, ativo) WHERE id = $1
         RETURNING id, nome, slug, ativo`,
        [id, dto.nome ?? null, dto.ativo ?? null],
      ));
    if (!r) throw new NotFoundException({ codigo: 'nao_encontrado', mensagem: 'Empresa não encontrada.' });
    return r;
  }

  @Get(':id/usuarios')
  usuarios(@Usuario() u: UsuarioLogado, @Param('id') id: string) {
    this.exigirMaster(u);
    uuid.parse(id);
    return this.db.tx(this.ctx(u, id), (tx) =>
      tx.q(
        `SELECT us.id, us.nome, us.email, us.ativo, us.ultimo_acesso, p.codigo AS perfil
           FROM usuario us JOIN perfil_acesso p ON p.id = us.perfil_id
          ORDER BY us.ativo DESC, us.nome`,
      ));
  }

  @Post(':id/usuarios')
  async criarUsuario(@Usuario() u: UsuarioLogado, @Param('id') id: string, @Body(new Validar(NovoUsuario)) dto: z.infer<typeof NovoUsuario>) {
    this.exigirMaster(u);
    uuid.parse(id);
    const hash = await bcrypt.hash(dto.senha, 10);
    const r = await this.db.tx(this.ctx(u, id), (tx) =>
      tx.um(
        `INSERT INTO usuario (perfil_id, nome, email, senha_hash)
         SELECT id, $2, $3, $4 FROM perfil_acesso WHERE codigo = $1
         RETURNING id, nome, email`,
        [dto.perfil, dto.nome, dto.email, hash],
      ));
    if (!r) throw new NotFoundException({ codigo: 'nao_encontrado', mensagem: 'Empresa não encontrada.' });
    return r;
  }

  /** Muda nome, perfil, situação ou redefine a senha de um usuário da empresa */
  @Put(':id/usuarios/:usuario')
  async editarUsuario(
    @Usuario() u: UsuarioLogado,
    @Param('id') id: string,
    @Param('usuario') usuarioId: string,
    @Body(new Validar(EditarUsuario)) dto: z.infer<typeof EditarUsuario>,
  ) {
    this.exigirMaster(u);
    uuid.parse(id);
    uuid.parse(usuarioId);
    const hash = dto.senha ? await bcrypt.hash(dto.senha, 10) : null;
    const r = await this.db.tx(this.ctx(u, id), (tx) =>
      tx.um(
        `UPDATE usuario SET nome = COALESCE($2, nome),
                perfil_id = COALESCE((SELECT id FROM perfil_acesso WHERE codigo = $3), perfil_id),
                ativo = COALESCE($4, ativo),
                senha_hash = COALESCE($5, senha_hash)
          WHERE id = $1
         RETURNING id, nome, email, ativo`,
        [usuarioId, dto.nome ?? null, dto.perfil ?? null, dto.ativo ?? null, hash],
      ));
    if (!r) throw new NotFoundException({ codigo: 'nao_encontrado', mensagem: 'Usuário não encontrado nesta empresa.' });
    return r;
  }
}
