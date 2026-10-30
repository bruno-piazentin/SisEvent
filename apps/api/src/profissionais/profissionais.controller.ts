import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { DbService, ContextoDb, Tx } from '../db/db.service';
import { RedesSociais, Validar, uuid } from '../comum/validacao';
import { Ctx, Requer } from '../auth/decorators';
import { config } from '../config';

const MEIOS = ['carro_proprio', 'moto_propria', 'transporte_publico', 'aplicativo', 'bicicleta', 'a_pe', 'carona'] as const;
const TAMANHOS = ['PP', 'P', 'M', 'G', 'GG', 'XG', 'XGG'] as const;
const TIPOS_CABELO = ['liso', 'ondulado', 'cacheado', 'crespo', 'raspado'] as const;
const CORES_CABELO = ['preto', 'castanho', 'loiro', 'ruivo', 'grisalho', 'colorido'] as const;

const FOTO_MAX = 5 * 1024 * 1024;
const NovaFoto = z.object({
  nome_arquivo: z.string().min(1).max(200),
  tipo_mime: z.enum(['image/jpeg', 'image/png', 'image/webp'], { errorMap: () => ({ message: 'Envie uma imagem JPG, PNG ou WEBP.' }) }),
  base64: z.string().min(10),
  legenda: z.string().max(300).nullish(),
});

const Disponibilidade = z.object({
  dia_semana: z.number().int().min(0).max(6),
  hora_inicio: z.string().regex(/^\d{2}:\d{2}$/),
  hora_fim: z.string().regex(/^\d{2}:\d{2}$/),
});

const ProfissionalBase = z.object({
  nome: z.string().min(3),
  nome_artistico: z.string().nullish(),
  cpf: z.string().regex(/^\d{11}$/, 'CPF com 11 dígitos, sem pontuação').nullish(),
  rg: z.string().nullish(),
  data_nascimento: z.coerce.date().nullish(),
  genero: z.string().nullish(),
  foto_url: z.string().url().nullish(),
  celular: z.string().regex(/^\+\d{12,13}$/, 'Celular no formato +5543999990000'),
  email: z.string().email().nullish(),
  redes_sociais: RedesSociais.optional(),
  cidade: z.string().nullish(),
  uf: z.string().length(2).nullish(),
  bairro: z.string().nullish(),
  cep: z.string().nullish(),
  praca_base_id: uuid.nullish(),
  raio_km: z.number().int().min(0).max(1000).nullish(),
  altura_cm: z.number().int().min(100).max(230).nullish(),
  peso_kg: z.number().positive().nullish(),
  manequim: z.number().int().nullish(),
  tamanho_camiseta: z.enum(TAMANHOS).nullish(),
  calcado: z.number().int().nullish(),
  busto_cm: z.number().int().nullish(),
  cintura_cm: z.number().int().nullish(),
  quadril_cm: z.number().int().nullish(),
  tipo_cabelo: z.enum(TIPOS_CABELO).nullish(),
  cor_cabelo: z.enum(CORES_CABELO).nullish(),
  cor_olhos: z.string().nullish(),
  tom_pele: z.string().nullish(),
  tatuagem_visivel: z.boolean().nullish(),
  meios_locomocao: z.array(z.enum(MEIOS)).default([]),
  cnh_categoria: z.string().nullish(),
  cnh_validade: z.coerce.date().nullish(),
  idiomas: z.array(z.string()).default([]),
  restricoes_alimentares: z.string().nullish(),
  experiencia: z.string().nullish(),
  observacoes_internas: z.string().nullish(),
  chave_pix: z.string().nullish(),
  tipo_chave_pix: z.string().nullish(),
  forma_contratacao: z.enum(['autonomo', 'mei', 'clt']).nullish(),
  cnpj_mei: z.string().nullish(),
  status: z.enum(['em_teste', 'ativo', 'inativo', 'bloqueado']).optional(),
  // relacionamentos
  funcoes: z.array(z.object({ funcao_id: uuid, nivel: z.number().int().min(1).max(3).default(1) })).optional(),
  pracas_aceitas: z.array(uuid).optional(),
  disponibilidade: z.array(Disponibilidade).optional(),
});
const NovoProfissional = ProfissionalBase;
const EditarProfissional = ProfissionalBase.partial();

const Filtros = z.object({
  q: z.string().optional(),
  funcao: uuid.optional(),
  praca: uuid.optional(),
  status: z.string().optional(),
  genero: z.string().optional(),
  altura_min: z.coerce.number().optional(),
  altura_max: z.coerce.number().optional(),
  tamanho: z.enum(TAMANHOS).optional(),
  // listas separadas por vírgula: "ruivo,loiro"
  tipo_cabelo: z.string().optional(),
  cor_cabelo: z.string().optional(),
  conducao_propria: z.coerce.boolean().optional(),
  nota_min: z.coerce.number().optional(),
  // "livre neste intervalo": sem conflito de escala nem indisponibilidade
  livre_inicio: z.coerce.date().optional(),
  livre_fim: z.coerce.date().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  por_pagina: z.coerce.number().int().min(1).max(200).default(50),
});

const CAMPOS_SIMPLES = Object.keys(ProfissionalBase.shape).filter(
  (k) => !['funcoes', 'pracas_aceitas', 'disponibilidade'].includes(k),
);

@Controller('profissionais')
export class ProfissionaisController {
  constructor(private readonly db: DbService) {}

  /** Busca com filtros combinados (perfil + cidade + disponibilidade + nota + uniforme) */
  @Get()
  @Requer('M1', 'ver')
  listar(@Ctx() ctx: ContextoDb, @Query(new Validar(Filtros)) f: z.infer<typeof Filtros>) {
    const where: string[] = ['true'];
    const p: unknown[] = [];
    const $ = (v: unknown) => { p.push(v); return `$${p.length}`; };

    if (f.q) {
      const q = $(f.q);
      where.push(`(busca_normalizada(pr.nome) % busca_normalizada(${q})
                   OR busca_normalizada(pr.nome) LIKE '%' || busca_normalizada(${q}) || '%')`);
    }
    if (f.funcao) where.push(`EXISTS (SELECT 1 FROM profissional_funcao pf WHERE pf.profissional_id = pr.id AND pf.funcao_id = ${$(f.funcao)})`);
    if (f.praca) {
      const pc = $(f.praca);
      where.push(`(pr.praca_base_id = ${pc} OR EXISTS (SELECT 1 FROM profissional_praca pp
                    WHERE pp.profissional_id = pr.id AND pp.praca_id = ${pc}))`);
    }
    if (f.status) where.push(`pr.status::text = ${$(f.status)}`);
    if (f.genero) where.push(`pr.genero = ${$(f.genero)}`);
    if (f.altura_min) where.push(`pr.altura_cm >= ${$(f.altura_min)}`);
    if (f.altura_max) where.push(`pr.altura_cm <= ${$(f.altura_max)}`);
    if (f.tamanho) where.push(`pr.tamanho_camiseta = ${$(f.tamanho)}::tamanho_roupa`);
    if (f.tipo_cabelo) where.push(`pr.tipo_cabelo = ANY(string_to_array(${$(f.tipo_cabelo)}, ','))`);
    if (f.cor_cabelo) where.push(`pr.cor_cabelo = ANY(string_to_array(${$(f.cor_cabelo)}, ','))`);
    if (f.conducao_propria) where.push(`pr.meios_locomocao && ARRAY['carro_proprio','moto_propria']::meio_locomocao[]`);
    if (f.nota_min) where.push(`h.nota_media >= ${$(f.nota_min)}`);
    if (f.livre_inicio && f.livre_fim) {
      const a = $(f.livre_inicio), b = $(f.livre_fim);
      where.push(`NOT EXISTS (SELECT 1 FROM alocacao a WHERE a.profissional_id = pr.id AND a.tipo = 'titular'
                    AND a.status IN ('convidado','confirmado') AND a.periodo && tstzrange(${a}, ${b}, '[)'))
                  AND NOT EXISTS (SELECT 1 FROM indisponibilidade i WHERE i.profissional_id = pr.id
                    AND i.periodo && tstzrange(${a}, ${b}, '[)'))`);
    }
    const sqlWhere = where.join(' AND ');
    const limite = $(f.por_pagina);
    const deslocamento = $((f.pagina - 1) * f.por_pagina);

    return this.db.tx(ctx, async (tx) => {
      const itens = await tx.q(
        `SELECT pr.id, pr.nome, pr.nome_artistico, pr.celular, pr.email, pr.cidade, pr.uf, pr.foto_url, pr.status,
                pr.altura_cm, pr.tamanho_camiseta, pr.meios_locomocao::text[] AS meios_locomocao, pr.genero,
                pr.tipo_cabelo, pr.cor_cabelo, pr.redes_sociais,
                date_part('year', age(pr.data_nascimento))::int AS idade,
                pc.nome AS praca_base,
                (SELECT array_agg(f.nome ORDER BY f.nome) FROM profissional_funcao pf JOIN funcao f ON f.id = pf.funcao_id
                  WHERE pf.profissional_id = pr.id) AS funcoes,
                h.nota_media, h.jobs_finalizados, h.faltas,
                count(*) OVER () AS total
           FROM profissional pr
           LEFT JOIN praca pc ON pc.id = pr.praca_base_id
           LEFT JOIN vw_historico_profissional h ON h.profissional_id = pr.id
          WHERE ${sqlWhere}
          ORDER BY pr.status = 'ativo' DESC, h.nota_media DESC NULLS LAST, pr.nome
          LIMIT ${limite} OFFSET ${deslocamento}`,
        p,
      );
      return { total: Number(itens[0]?.total ?? 0), pagina: f.pagina, itens: itens.map(({ total, ...r }) => r) };
    });
  }

  @Get(':id')
  @Requer('M1', 'ver')
  async detalhe(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Req() req: any) {
    uuid.parse(id);
    const verDadosSensiveis = await req.pode('M1', 'editar');
    const verFinanceiro = await req.pode('M7', 'ver_valores');
    return this.db.tx(ctx, async (tx) => {
      // arrays de enum voltam como texto cru no driver pg: converte para text[]
      const pr = await tx.um('SELECT *, meios_locomocao::text[] AS meios_locomocao FROM profissional WHERE id = $1', [id]);
      if (!pr) throw new NotFoundException();
      if (!verDadosSensiveis) {
        pr.cpf = pr.cpf ? `***.***.***-${pr.cpf.slice(-2)}` : null;
        pr.rg = pr.rg ? '***' : null;
      }
      if (!verFinanceiro) {
        for (const k of ['chave_pix', 'banco', 'agencia', 'conta', 'cnpj_mei']) pr[k] = pr[k] ? '***' : null;
      }
      const [funcoes, pracas, disponibilidade, documentos, historico, avaliacoes] = await Promise.all([
        tx.q(`SELECT f.id AS funcao_id, f.nome, pf.nivel FROM profissional_funcao pf JOIN funcao f ON f.id = pf.funcao_id
               WHERE pf.profissional_id = $1 ORDER BY f.nome`, [id]),
        tx.q(`SELECT pc.id, pc.nome, pc.uf FROM profissional_praca pp JOIN praca pc ON pc.id = pp.praca_id
               WHERE pp.profissional_id = $1`, [id]),
        tx.q(`SELECT dia_semana, to_char(hora_inicio,'HH24:MI') AS hora_inicio, to_char(hora_fim,'HH24:MI') AS hora_fim
                FROM disponibilidade_semanal WHERE profissional_id = $1 ORDER BY dia_semana, hora_inicio`, [id]),
        tx.q(`SELECT id, tipo, arquivo_url, validade, verificado_em FROM documento_profissional
               WHERE profissional_id = $1 ORDER BY validade NULLS LAST`, [id]),
        tx.um('SELECT * FROM vw_historico_profissional WHERE profissional_id = $1', [id]),
        tx.q(`SELECT e.nome AS evento, t.inicio, av.nota, av.observacao
                FROM avaliacao av JOIN alocacao a ON a.id = av.alocacao_id JOIN posto p ON p.id = a.posto_id
                JOIN turno t ON t.id = p.turno_id JOIN evento e ON e.id = t.evento_id
               WHERE a.profissional_id = $1 ORDER BY t.inicio DESC LIMIT 20`, [id]),
      ]);
      return { ...pr, funcoes, pracas_aceitas: pracas, disponibilidade, documentos, historico, avaliacoes };
    });
  }

  @Post()
  @Requer('M1', 'criar')
  criar(@Ctx() ctx: ContextoDb, @Body(new Validar(NovoProfissional)) dto: z.infer<typeof NovoProfissional>) {
    return this.db.tx(ctx, async (tx) => {
      const campos = CAMPOS_SIMPLES.filter((k) => (dto as any)[k] !== undefined);
      const valores = campos.map((k) => (dto as any)[k]);
      const pr = await tx.um<{ id: string }>(
        `INSERT INTO profissional (${campos.join(', ')}) VALUES (${campos.map((_, i) => `$${i + 1}`).join(', ')})
         RETURNING id`,
        valores,
      );
      await this.salvarRelacionamentos(tx, pr!.id, dto);
      return pr;
    });
  }

  @Patch(':id')
  @Requer('M1', 'editar')
  editar(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(EditarProfissional)) dto: z.infer<typeof EditarProfissional>) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const campos = CAMPOS_SIMPLES.filter((k) => (dto as any)[k] !== undefined);
      if (campos.length) {
        const r = await tx.um(
          `UPDATE profissional SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id`,
          [id, ...campos.map((k) => (dto as any)[k])],
        );
        if (!r) throw new NotFoundException();
      }
      await this.salvarRelacionamentos(tx, id, dto);
      return { id };
    });
  }

  /** Substitui a grade semanal de disponibilidade */
  @Put(':id/disponibilidade')
  @Requer('M1', 'editar')
  disponibilidade(@Ctx() ctx: ContextoDb, @Param('id') id: string,
                  @Body(new Validar(z.array(Disponibilidade))) dto: z.infer<typeof Disponibilidade>[]) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) => this.salvarRelacionamentos(tx, id, { disponibilidade: dto }));
  }

  @Post(':id/avaliacoes')
  @Requer('M5', 'editar')
  avaliar(@Ctx() ctx: ContextoDb, @Param('id') _id: string,
          @Body(new Validar(z.object({ alocacao_id: uuid, nota: z.number().int().min(1).max(5), observacao: z.string().nullish() })))
          dto: { alocacao_id: string; nota: number; observacao?: string | null }) {
    return this.db.tx(ctx, (tx) =>
      tx.um(
        `INSERT INTO avaliacao (alocacao_id, nota, observacao, avaliado_por) VALUES ($1, $2, $3, app_usuario())
         ON CONFLICT (alocacao_id) DO UPDATE SET nota = EXCLUDED.nota, observacao = EXCLUDED.observacao,
                avaliado_por = EXCLUDED.avaliado_por, avaliado_em = now()
         RETURNING *`,
        [dto.alocacao_id, dto.nota, dto.observacao ?? null],
      ),
    );
  }

  /**
   * Gera o link de acesso do profissional (sem senha). O token só aparece nesta resposta.
   * Enviar por WhatsApp/SMS — no MVP a central copia e cola; depois, integração com API oficial.
   */
  @Post(':id/link-acesso')
  @Requer('M5', 'criar')
  async linkAcesso(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um<{ token: string }>(`SELECT gerar_acesso_profissional($1, '30 days') AS token`, [id]);
      const pr = await tx.um('SELECT nome, celular FROM profissional WHERE id = $1', [id]);
      const link = `${config.appUrl}/p/${r!.token}`;
      const mensagem = `Olá, ${pr.nome.split(' ')[0]}! Este é seu acesso à Rafa Dutra Eventos: ${link}\n` +
        `Por ele você confirma convocações e faz check-in nos eventos. Não compartilhe.`;
      return {
        link,
        expira_em_dias: 30,
        whatsapp: `https://wa.me/${pr.celular.replace(/\D/g, '')}?text=${encodeURIComponent(mensagem)}`,
      };
    });
  }

  // ---- fotos do profissional ----
  @Get(':id/fotos')
  @Requer('M1', 'ver')
  fotos(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) =>
      tx.q(`SELECT f.id, f.nome_arquivo, f.tipo_mime, f.tamanho, f.legenda, f.principal, f.enviado_em, us.nome AS enviado_por
              FROM profissional_foto f LEFT JOIN usuario us ON us.id = f.enviado_por
             WHERE f.profissional_id = $1 ORDER BY f.principal DESC, f.enviado_em`, [id]));
  }

  @Post(':id/fotos')
  @Requer('M1', 'editar')
  novaFoto(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(NovaFoto)) dto: z.infer<typeof NovaFoto>) {
    uuid.parse(id);
    const conteudo = Buffer.from(dto.base64, 'base64');
    if (!conteudo.length || conteudo.length > FOTO_MAX) throw new BadRequestException({ mensagem: 'A foto deve ter até 5 MB.' });
    return this.db.tx(ctx, async (tx) => {
      if (!(await tx.um('SELECT id FROM profissional WHERE id = $1', [id]))) throw new NotFoundException();
      // a primeira foto vira a principal
      return tx.um(`INSERT INTO profissional_foto (profissional_id, nome_arquivo, tipo_mime, tamanho, conteudo, legenda, principal)
                    VALUES ($1, $2, $3, $4, $5, $6, NOT EXISTS (SELECT 1 FROM profissional_foto WHERE profissional_id = $1))
                    RETURNING id, nome_arquivo, tipo_mime, tamanho, legenda, principal, enviado_em`,
        [id, dto.nome_arquivo, dto.tipo_mime, conteudo.length, conteudo, dto.legenda ?? null]);
    });
  }

  @Get(':id/fotos/:foto')
  @Requer('M1', 'ver')
  async foto(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Param('foto') foto: string, @Res() res: Response) {
    uuid.parse(id); uuid.parse(foto);
    const f = await this.db.tx(ctx, (tx) => tx.um<{ tipo_mime: string; conteudo: Buffer }>(
      'SELECT tipo_mime, conteudo FROM profissional_foto WHERE id = $1 AND profissional_id = $2', [foto, id]));
    if (!f) throw new NotFoundException();
    res.set({ 'Content-Type': f.tipo_mime, 'Cache-Control': 'private, max-age=86400' }).send(f.conteudo);
  }

  @Post(':id/fotos/:foto/principal')
  @Requer('M1', 'editar')
  fotoPrincipal(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Param('foto') foto: string) {
    uuid.parse(id); uuid.parse(foto);
    return this.db.tx(ctx, async (tx) => {
      await tx.q('UPDATE profissional_foto SET principal = false WHERE profissional_id = $1 AND principal', [id]);
      const r = await tx.um('UPDATE profissional_foto SET principal = true WHERE id = $1 AND profissional_id = $2 RETURNING id', [foto, id]);
      if (!r) throw new NotFoundException();
      return r;
    });
  }

  @Delete(':id/fotos/:foto')
  @Requer('M1', 'editar')
  removerFoto(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Param('foto') foto: string) {
    uuid.parse(id); uuid.parse(foto);
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um<{ principal: boolean }>('DELETE FROM profissional_foto WHERE id = $1 AND profissional_id = $2 RETURNING principal', [foto, id]);
      if (!r) throw new NotFoundException();
      // tirou a principal: a mais antiga que sobrou assume
      if (r.principal) {
        await tx.q(`UPDATE profissional_foto SET principal = true
                     WHERE id = (SELECT id FROM profissional_foto WHERE profissional_id = $1 ORDER BY enviado_em LIMIT 1)`, [id]);
      }
      return { id: foto };
    });
  }

  private async salvarRelacionamentos(tx: Tx, id: string, dto: Partial<z.infer<typeof ProfissionalBase>>) {
    if (dto.funcoes) {
      await tx.q('DELETE FROM profissional_funcao WHERE profissional_id = $1', [id]);
      for (const f of dto.funcoes) {
        await tx.q('INSERT INTO profissional_funcao (profissional_id, funcao_id, nivel) VALUES ($1, $2, $3)', [id, f.funcao_id, f.nivel]);
      }
    }
    if (dto.pracas_aceitas) {
      await tx.q('DELETE FROM profissional_praca WHERE profissional_id = $1', [id]);
      for (const p of dto.pracas_aceitas) {
        await tx.q('INSERT INTO profissional_praca (profissional_id, praca_id) VALUES ($1, $2)', [id, p]);
      }
    }
    if (dto.disponibilidade) {
      await tx.q('DELETE FROM disponibilidade_semanal WHERE profissional_id = $1', [id]);
      for (const d of dto.disponibilidade) {
        await tx.q(
          'INSERT INTO disponibilidade_semanal (profissional_id, dia_semana, hora_inicio, hora_fim) VALUES ($1, $2, $3, $4)',
          [id, d.dia_semana, d.hora_inicio, d.hora_fim],
        );
      }
    }
    return { ok: true };
  }
}
