import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Post, Put, Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { DbService, ContextoDb, Tx } from '../db/db.service';
import { DadosCadastrais, Validar, cnpjValido, cpfValido, uuid } from '../comum/validacao';
import { Usuario, UsuarioLogado } from '../auth/decorators';
import { Logo, MODULOS } from './admin.controller';

const PERFIS = ['admin', 'central', 'supervisor', 'financeiro'] as const;

// colunas de tenant que vêm do cadastro (as mesmas do cliente); o nome fantasia vira tenant.nome
const CAMPOS_EMPRESA = ['pessoa', 'razao_social', 'cnpj', 'cpf', 'telefone', 'email', 'redes_sociais',
  'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'logo', 'prazos_eventos'] as const;
type Dados = Partial<Record<(typeof CAMPOS_EMPRESA)[number], unknown>>;

/** Empresa nova com perfis padrão, módulos e regra de custo. Rodar no contexto da própria empresa (RLS). */
export async function criarEmpresa(tx: Tx, id: string, nome: string, slug: string, modulos: readonly string[], dados: Dados = {}) {
  dados = { razao_social: nome, ...dados };   // sem razão social informada (primeiro acesso do master), usa o nome
  const campos = CAMPOS_EMPRESA.filter((k) => dados[k] !== undefined);
  await tx.q(
    `INSERT INTO tenant (id, nome, slug${campos.map((k) => `, ${k}`).join('')})
     VALUES ($1, $2, $3${campos.map((_, i) => `, $${i + 4}`).join('')})`,
    [id, nome, slug, ...campos.map((k) => dados[k])],
  );
  await tx.q('SELECT criar_perfis_padrao($1)', [id]);
  // DP (dados pessoais) não é contratado: fica sempre liberado e quem vê é decidido pelas permissões
  await tx.q(`INSERT INTO modulo_liberado (tenant_id, modulo) SELECT $1::uuid, m FROM unnest($2::text[] || '{DP}') m GROUP BY m`, [id, modulos]);
  await tx.q('INSERT INTO regra_custo (tenant_id) VALUES ($1)', [id]);
}

// código usado no login; só minúsculas, números e hífen
const Slug = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Use de 2 a 40 letras minúsculas, números ou hífen.');
const Cor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor no formato #RRGGBB.');
/** Faixas de prazo dos eventos (cores da tela inicial e do Campo) */
const PrazosEventos = z.object({
  ate_dias: z.number().int().min(1).max(60),
  medio_ate_dias: z.number().int().min(2).max(365),
  historico_dias: z.number().int().min(1).max(365),
  cores: z.object({ encerrado: Cor, hoje: Cor, proximo: Cor, medio: Cor, distante: Cor, cancelado: Cor }),
}).refine((p) => p.medio_ate_dias > p.ate_dias, { message: 'O segundo prazo precisa ser maior que o primeiro.', path: ['medio_ate_dias'] });
const Modulos = z.array(z.enum(MODULOS)).min(1, 'Libere pelo menos um módulo.');
// mesmos dados do cadastro de clientes; o nome fantasia (ou a razão social) é o nome mostrado no sistema
const NovaEmpresa = DadosCadastrais.extend({
  slug: Slug,
  modulos: Modulos,
  logo: Logo.shape.logo.optional(),
  prazos_eventos: PrazosEventos.optional(),
  admin: z.object({
    nome: z.string().trim().min(2),
    email: z.string().trim().email(),
    senha: z.string().min(8),
  }),
});
const EditarEmpresa = DadosCadastrais.partial().extend({
  slug: Slug.optional(),
  modulos: Modulos.optional(),
  logo: Logo.shape.logo.optional(),
  prazos_eventos: PrazosEventos.optional(),
  ativo: z.boolean().optional(),
});

/** Pessoa física não tem CNPJ e jurídica não tem CPF; documento novo precisa ter os dígitos certos */
function conferirDocumento(dto: Partial<z.infer<typeof DadosCadastrais>>, atual?: { pessoa: string; cnpj: string | null; cpf: string | null }) {
  if (dto.pessoa === undefined && dto.cnpj === undefined && dto.cpf === undefined) return;
  const pessoa = dto.pessoa ?? atual?.pessoa ?? 'juridica';
  const [coluna, rotulo, valido] = pessoa === 'fisica' ? ['cpf', 'CPF', cpfValido] as const : ['cnpj', 'CNPJ', cnpjValido] as const;
  if (pessoa === 'fisica') dto.cnpj = null; else dto.cpf = null;
  const doc = dto[coluna];
  if (doc && doc !== atual?.[coluna] && !valido(doc)) {
    throw new BadRequestException({ codigo: 'validacao', mensagem: `${rotulo} inválido: confira os dígitos.`, campos: [{ campo: coluna, mensagem: `${rotulo} inválido` }] });
  }
}

/** Duplicidade vinda dos índices únicos do banco, dizendo qual campo repetiu */
async function semDuplicar<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    const campo = ({ tenant_slug_key: 'código de acesso', tenant_cnpj_key: 'CNPJ', tenant_cpf_key: 'CPF' } as Record<string, string>)[e?.constraint];
    if (e?.code === '23505' && campo) throw new ConflictException({ codigo: 'duplicado', mensagem: `Já existe uma empresa com este ${campo}.` });
    throw e;
  }
}
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
    conferirDocumento(dto);
    const nome = dto.nome_fantasia?.trim() || dto.razao_social.trim();
    return semDuplicar(() => this.db.tx(this.ctx(u, id), async (tx) => {
      await criarEmpresa(tx, id, nome, dto.slug, dto.modulos, dto);
      await tx.q(
        `INSERT INTO usuario (perfil_id, nome, email, senha_hash)
         SELECT id, $1, $2, $3 FROM perfil_acesso WHERE codigo = 'admin'`,
        [dto.admin.nome, dto.admin.email, hash],
      );
      return { id, nome, slug: dto.slug };
    }));
  }

  /** Cadastro completo da empresa, para a tela de edição */
  @Get(':id')
  async ver(@Usuario() u: UsuarioLogado, @Param('id') id: string) {
    this.exigirMaster(u);
    uuid.parse(id);
    const r = await this.db.tx(this.ctx(u, id), async (tx) => {
      const e = await tx.um(`SELECT id, nome AS nome_fantasia, slug, ativo, ${CAMPOS_EMPRESA.join(', ')} FROM tenant WHERE id = $1`, [id]);
      if (!e) return null;
      const m = await tx.q<{ modulo: string }>('SELECT modulo FROM modulo_liberado WHERE ativo AND (expira_em IS NULL OR expira_em > now())');
      return { ...e, modulos: m.map((x) => x.modulo) };
    });
    if (!r) throw new NotFoundException({ codigo: 'nao_encontrado', mensagem: 'Empresa não encontrada.' });
    return r;
  }

  /** Edita o cadastro, o código de acesso, os módulos, o logo ou a situação da empresa */
  @Put(':id')
  async editar(@Usuario() u: UsuarioLogado, @Param('id') id: string, @Body(new Validar(EditarEmpresa)) dto: z.infer<typeof EditarEmpresa>) {
    this.exigirMaster(u);
    uuid.parse(id);
    if (dto.ativo === false && id === u.tenantId) {
      throw new ForbiddenException({ codigo: 'propria_empresa', mensagem: 'Não é possível inativar a empresa em que você está logado.' });
    }
    return semDuplicar(() => this.db.tx(this.ctx(u, id), async (tx) => {
      const atual = await tx.um<{ pessoa: string; cnpj: string | null; cpf: string | null }>('SELECT pessoa, cnpj, cpf FROM tenant WHERE id = $1', [id]);
      if (!atual) throw new NotFoundException({ codigo: 'nao_encontrado', mensagem: 'Empresa não encontrada.' });
      conferirDocumento(dto, atual);
      const valores: Record<string, unknown> = {};
      for (const k of [...CAMPOS_EMPRESA, 'slug', 'ativo'] as const) if (dto[k] !== undefined) valores[k] = dto[k];
      const nome = dto.nome_fantasia?.trim() || dto.razao_social?.trim();
      if (nome) valores.nome = nome;
      const campos = Object.keys(valores);
      if (campos.length) {
        await tx.q(`UPDATE tenant SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
          [id, ...campos.map((k) => valores[k])]);
      }
      if (dto.modulos) {
        // liga os marcados e desliga os demais
        await tx.q(
          `INSERT INTO modulo_liberado (tenant_id, modulo, ativo) SELECT $1, m, m = ANY($2::text[]) FROM unnest($3::text[]) AS m
           ON CONFLICT (tenant_id, modulo) DO UPDATE SET ativo = EXCLUDED.ativo,
                  liberado_em = CASE WHEN EXCLUDED.ativo AND NOT modulo_liberado.ativo THEN now() ELSE modulo_liberado.liberado_em END`,
          [id, dto.modulos, MODULOS]);
      }
      return tx.um('SELECT id, nome, slug, ativo FROM tenant WHERE id = $1', [id]);
    }));
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
                senha_hash = COALESCE($5, senha_hash),
                sessoes_desde = CASE WHEN $5 IS NOT NULL OR $4 IS FALSE THEN now() ELSE sessoes_desde END   -- derruba as sessões abertas
          WHERE id = $1
         RETURNING id, nome, email, ativo`,
        [usuarioId, dto.nome ?? null, dto.perfil ?? null, dto.ativo ?? null, hash],
      ));
    if (!r) throw new NotFoundException({ codigo: 'nao_encontrado', mensagem: 'Usuário não encontrado nesta empresa.' });
    return r;
  }
}
