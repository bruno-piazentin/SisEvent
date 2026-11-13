import { BadRequestException, Body, ConflictException, Controller, Delete, Get, HttpCode, HttpException, Ip, NotFoundException, Param, Post, Query, Req, Res, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { DbService, ContextoDb } from '../db/db.service';
import { RedesSociais, Validar, alturaCm, celular, inteiro, uuid } from '../comum/validacao';
import { Ctx, Publico, Requer } from '../auth/decorators';
import { limitar } from '../comum/limite';
import { CORES_CABELO, MEIOS, TAMANHOS, TIPOS_CABELO } from '../profissionais/profissionais.controller';
import { VERSAO_POLITICA } from '../comum/lgpd';
import { imagemValida } from '../comum/imagem';

/**
 * Casting (módulo M2, Captação): inscrição pública pelo link da empresa e fila de triagem.
 * A inscrição não entra no banco de talentos: só a aprovação cria o profissional ("em teste").
 */
const FOTO_MAX = 2 * 1024 * 1024;   // as fotos chegam reduzidas pelo navegador
// Teto de inscrições por empresa em 24h, contado no banco: vale para todas as instâncias da API
// (o limite por IP fica na memória de cada uma). Segura robô que troca de IP para lotar a fila.
const INSCRICOES_DIA = 300;
const FotoInscricao = z.object({
  nome_arquivo: z.string().trim().min(1).max(200),
  tipo_mime: z.enum(['image/jpeg', 'image/png', 'image/webp'], { errorMap: () => ({ message: 'Envie fotos JPG, PNG ou WEBP.' }) }),
  base64: z.string().min(10).max(Math.ceil(FOTO_MAX / 3) * 4),
});
const texto = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);

const Inscricao = z.object({
  nome: z.string().trim().min(3, 'Informe o nome completo').max(120),
  nome_artistico: texto(120),
  celular,
  email: z.string().trim().email('E-mail inválido').max(254).nullish().or(z.literal('').transform(() => null)),
  data_nascimento: z.coerce.date().refine((d) => {
    const hoje = new Date();
    const dezoito = new Date(hoje.getFullYear() - 18, hoje.getMonth(), hoje.getDate());
    return d <= dezoito && d.getFullYear() > 1930;
  }, 'É preciso ter 18 anos ou mais para se inscrever.'),
  genero: texto(40),
  redes_sociais: RedesSociais.optional(),
  cidade: z.string().trim().min(2, 'Informe a cidade').max(80),
  uf: z.string().trim().length(2, 'UF com 2 letras').transform((v) => v.toUpperCase()),
  bairro: texto(80),
  praca_base_id: uuid.nullish(),
  funcoes: z.array(uuid).max(20).default([]),
  altura_cm: alturaCm.nullish(),
  manequim: inteiro().pipe(z.number().min(30).max(70)).nullish(),
  tamanho_camiseta: z.enum(TAMANHOS).nullish(),
  calcado: inteiro().pipe(z.number().min(30).max(50)).nullish(),
  tipo_cabelo: z.enum(TIPOS_CABELO).nullish(),
  cor_cabelo: z.enum(CORES_CABELO).nullish(),
  cor_olhos: texto(40),
  tom_pele: texto(40),
  tatuagem_visivel: z.boolean().nullish(),
  meios_locomocao: z.array(z.enum(MEIOS)).max(MEIOS.length).default([]),
  idiomas: z.array(z.string().trim().min(2).max(30)).max(10).default([]),
  experiencia: texto(2000),
  fotos: z.array(FotoInscricao).min(1, 'Envie pelo menos uma foto').max(4, 'Envie no máximo 4 fotos'),
  consentimento: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar o uso dos dados para o casting.' }) }),
  site: z.string().max(0).optional(),   // campo escondido: robô que preenche tudo cai aqui
});

const Empresa = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,64}$/);

@Publico()
@Controller('publico/casting')
export class CastingPublicoController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  private async empresa(slug: string) {
    const e = await this.db.tx({}, (tx) => tx.um<{ id: string; nome: string; logo: string | null }>(
      'SELECT id, nome, logo FROM casting_empresa($1)', [Empresa.parse(slug)]));
    if (!e) throw new NotFoundException({ codigo: 'casting_indisponivel', mensagem: 'Este link de casting não está disponível.' });
    return e;
  }

  /** Dados para montar o formulário: nome e logo da empresa, funções e praças dela */
  @Get(':empresa')
  async formulario(@Param('empresa') slug: string, @Ip() ip: string) {
    limitar(`casting-ver:${ip}`, 60);
    const e = await this.empresa(slug);
    return this.db.tx({ tenantId: e.id }, async (tx) => ({
      empresa: { nome: e.nome, logo: e.logo },
      funcoes: await tx.q('SELECT id, nome FROM funcao ORDER BY nome'),
      pracas: await tx.q('SELECT id, nome, uf FROM praca ORDER BY nome'),
    }));
  }

  @Post(':empresa')
  @HttpCode(201)
  async inscrever(@Param('empresa') slug: string, @Ip() ip: string, @Body(new Validar(Inscricao)) dto: z.infer<typeof Inscricao>) {
    limitar(`casting:${ip}`, 5, 60 * 60_000, 'Muitas inscrições enviadas deste endereço. Tente de novo mais tarde.');
    const e = await this.empresa(slug);
    const fotos = dto.fotos.map((f) => ({ ...f, conteudo: Buffer.from(f.base64, 'base64') }));
    if (fotos.some((f) => !f.conteudo.length || f.conteudo.length > FOTO_MAX)) {
      throw new BadRequestException({ codigo: 'validacao', mensagem: 'Cada foto deve ter até 2 MB.' });
    }
    if (fotos.some((f) => !imagemValida(f.conteudo, f.tipo_mime))) {
      throw new BadRequestException({ codigo: 'validacao', mensagem: 'Envie fotos JPG, PNG ou WEBP válidas.' });
    }
    return this.db.tx({ tenantId: e.id }, async (tx) => {
      // prazo de guarda: reprovadas há mais de 180 dias saem da base (aproveita cada nova inscrição)
      await tx.q('SELECT limpar_inscricoes_vencidas()');
      const hoje = await tx.um<{ n: number }>("SELECT count(*)::int AS n FROM inscricao_casting WHERE criado_em > now() - interval '1 day'");
      if (hoje!.n >= INSCRICOES_DIA) {
        throw new HttpException({ codigo: 'muitas_tentativas', mensagem: 'Este casting recebeu muitas inscrições hoje. Tente de novo amanhã.' }, 429);
      }
      // o celular não é confirmado: se outra pessoa usou o seu, a empresa reprova e exclui a inscrição falsa
      if (await tx.um("SELECT 1 FROM inscricao_casting WHERE celular = $1 AND status = 'pendente'", [dto.celular])) {
        throw new ConflictException({ codigo: 'inscricao_em_analise',
          mensagem: `Já existe uma inscrição em análise com este celular. Se não foi você quem enviou, fale com a ${e.nome}: ela pode cancelar essa inscrição e liberar o seu celular.` });
      }
      // só funções e praça desta empresa (o RLS filtra as de outras)
      const funcoes = (await tx.q<{ id: string }>('SELECT id FROM funcao WHERE id = ANY($1::uuid[])', [dto.funcoes])).map((f) => f.id);
      const praca = dto.praca_base_id ? (await tx.um<{ id: string }>('SELECT id FROM praca WHERE id = $1', [dto.praca_base_id]))?.id ?? null : null;
      const i = await tx.um<{ id: string }>(
        `INSERT INTO inscricao_casting (nome, nome_artistico, celular, email, data_nascimento, genero, redes_sociais, cidade, uf, bairro,
                                        praca_base_id, funcoes, altura_cm, manequim, tamanho_camiseta, calcado, tipo_cabelo, cor_cabelo,
                                        cor_olhos, tom_pele, tatuagem_visivel, meios_locomocao, idiomas, experiencia, consentimento_lgpd_em, versao_politica)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24, now(), $25) RETURNING id`,
        [dto.nome, dto.nome_artistico, dto.celular, dto.email ?? null, dto.data_nascimento, dto.genero, JSON.stringify(dto.redes_sociais ?? {}),
         dto.cidade, dto.uf, dto.bairro, praca, funcoes, dto.altura_cm ?? null, dto.manequim ?? null, dto.tamanho_camiseta ?? null,
         dto.calcado ?? null, dto.tipo_cabelo ?? null, dto.cor_cabelo ?? null, dto.cor_olhos, dto.tom_pele, dto.tatuagem_visivel ?? null,
         dto.meios_locomocao, dto.idiomas, dto.experiencia, VERSAO_POLITICA]);
      for (const [ordem, f] of fotos.entries()) {
        await tx.q('INSERT INTO inscricao_casting_foto (inscricao_id, nome_arquivo, tipo_mime, tamanho, conteudo, ordem) VALUES ($1,$2,$3,$4,$5,$6)',
          [i!.id, f.nome_arquivo, f.tipo_mime, f.conteudo.length, f.conteudo, ordem]);
      }
      return { ok: true };
    });
  }
}

const Filtro = z.object({
  status: z.enum(['pendente', 'aprovada', 'reprovada']).default('pendente'),
  busca: z.string().trim().max(100).optional(),
});

@Controller('captacao')
export class CaptacaoController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get('resumo')
  @Requer('M2', 'ver')
  resumo(@Ctx() ctx: ContextoDb) {
    return this.db.tx(ctx, (tx) => tx.um(
      `SELECT count(*) FILTER (WHERE status = 'pendente')::int AS pendente,
              count(*) FILTER (WHERE status = 'aprovada')::int AS aprovada,
              count(*) FILTER (WHERE status = 'reprovada')::int AS reprovada
         FROM inscricao_casting`));
  }

  @Get('inscricoes')
  @Requer('M2', 'ver')
  listar(@Ctx() ctx: ContextoDb, @Query(new Validar(Filtro)) f: z.infer<typeof Filtro>) {
    return this.db.tx(ctx, (tx) => tx.q(
      `SELECT i.id, i.nome, i.nome_artistico, i.celular, i.cidade, i.uf, i.altura_cm, i.status, i.criado_em, i.analisada_em,
              date_part('year', age(i.data_nascimento))::int AS idade,
              (SELECT array_agg(fn.nome ORDER BY fn.nome) FROM funcao fn WHERE fn.id = ANY(i.funcoes)) AS funcoes,
              (SELECT f.id FROM inscricao_casting_foto f WHERE f.inscricao_id = i.id ORDER BY f.ordem LIMIT 1) AS foto_id
         FROM inscricao_casting i
        WHERE i.status::text = $1
          AND ($2::text IS NULL OR busca_normalizada(i.nome || ' ' || coalesce(i.nome_artistico, '') || ' ' || coalesce(i.cidade, ''))
                                    LIKE '%' || busca_normalizada($2) || '%')
        ORDER BY CASE WHEN $1 = 'pendente' THEN i.criado_em END ASC, i.analisada_em DESC NULLS LAST, i.criado_em DESC
        LIMIT 300`, [f.status, f.busca || null]));
  }

  @Get('inscricoes/:id')
  @Requer('M2', 'ver')
  async detalhe(@Ctx() ctx: ContextoDb, @Req() req: any, @Param('id') id: string) {
    uuid.parse(id);
    const verDadosPessoais = await req.podeDadosPessoais();
    return this.db.tx(ctx, async (tx) => {
      const i = await tx.um<any>(
        `SELECT i.*, date_part('year', age(i.data_nascimento))::int AS idade, p.nome AS praca, p.uf AS praca_uf, u.nome AS analisada_por_nome,
                (SELECT coalesce(json_agg(json_build_object('id', fn.id, 'nome', fn.nome) ORDER BY fn.nome), '[]') FROM funcao fn WHERE fn.id = ANY(i.funcoes)) AS funcoes_nomes,
                (SELECT coalesce(json_agg(f.id ORDER BY f.ordem), '[]') FROM inscricao_casting_foto f WHERE f.inscricao_id = i.id) AS fotos
           FROM inscricao_casting i LEFT JOIN praca p ON p.id = i.praca_base_id LEFT JOIN usuario u ON u.id = i.analisada_por
          WHERE i.id = $1`, [id]);
      if (!i) throw new NotFoundException();
      // data de nascimento é dado pessoal (permissão DP); a idade basta para a triagem
      if (!verDadosPessoais) delete i.data_nascimento;
      return i;
    });
  }

  @Get('inscricoes/:id/fotos/:foto')
  @Requer('M2', 'ver')
  async foto(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Param('foto') foto: string, @Res() res: Response) {
    uuid.parse(id); uuid.parse(foto);
    const f = await this.db.tx(ctx, (tx) => tx.um<{ tipo_mime: string; conteudo: Buffer }>(
      'SELECT tipo_mime, conteudo FROM inscricao_casting_foto WHERE id = $1 AND inscricao_id = $2', [foto, id]));
    if (!f) throw new NotFoundException();
    res.set({ 'Content-Type': f.tipo_mime, 'Cache-Control': 'private, max-age=86400' }).send(f.conteudo);
  }

  /** Aprovar: vira profissional "em teste" no banco de talentos, com funções e fotos */
  @Post('inscricoes/:id/aprovar')
  @Requer('M2', 'aprovar')
  @HttpCode(200)
  aprovar(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const i = await tx.um<{ celular: string; status: string }>('SELECT celular, status FROM inscricao_casting WHERE id = $1 FOR UPDATE', [id]);
      if (!i) throw new NotFoundException();
      if (i.status !== 'pendente') throw new ConflictException({ codigo: 'ja_analisada', mensagem: 'Esta inscrição já foi analisada.' });
      const existe = await tx.um<{ id: string; nome: string }>('SELECT id, nome FROM profissional WHERE celular = $1', [i.celular]);
      if (existe) {
        throw new ConflictException({ codigo: 'ja_cadastrado', profissional_id: existe.id,
          mensagem: `Este celular já está no Banco de talentos (${existe.nome}). Atualize o cadastro existente e reprove esta inscrição.` });
      }
      const p = await tx.um<{ id: string }>(
        `INSERT INTO profissional (nome, nome_artistico, celular, email, data_nascimento, genero, redes_sociais, cidade, uf, bairro,
                                   praca_base_id, altura_cm, manequim, tamanho_camiseta, calcado, tipo_cabelo, cor_cabelo, cor_olhos,
                                   tom_pele, tatuagem_visivel, meios_locomocao, idiomas, experiencia, status, origem, consentimento_lgpd_em, versao_politica)
         SELECT nome, nome_artistico, celular, email, data_nascimento, genero, redes_sociais, cidade, uf, bairro,
                praca_base_id, altura_cm, manequim, tamanho_camiseta, calcado, tipo_cabelo, cor_cabelo, cor_olhos,
                tom_pele, tatuagem_visivel, meios_locomocao, idiomas, experiencia, 'em_teste', 'formulario_publico', consentimento_lgpd_em, versao_politica
           FROM inscricao_casting WHERE id = $1
         RETURNING id`, [id]);
      await tx.q(
        `INSERT INTO profissional_funcao (profissional_id, funcao_id, nivel)
         SELECT $2, fn.id, 1 FROM inscricao_casting i JOIN funcao fn ON fn.id = ANY(i.funcoes) WHERE i.id = $1`, [id, p!.id]);
      await tx.q(
        `INSERT INTO profissional_foto (profissional_id, nome_arquivo, tipo_mime, tamanho, conteudo, principal)
         SELECT $2, nome_arquivo, tipo_mime, tamanho, conteudo, row_number() OVER (ORDER BY ordem) = 1
           FROM inscricao_casting_foto WHERE inscricao_id = $1`, [id, p!.id]);
      // as fotos passam a morar no cadastro do profissional: não ficam duplicadas na inscrição
      await tx.q('DELETE FROM inscricao_casting_foto WHERE inscricao_id = $1', [id]);
      await tx.q(`UPDATE inscricao_casting SET status = 'aprovada', analisada_por = app_usuario(), analisada_em = now(), profissional_id = $2
                   WHERE id = $1`, [id, p!.id]);
      return { profissional_id: p!.id };
    });
  }

  @Post('inscricoes/:id/reprovar')
  @Requer('M2', 'aprovar')
  @HttpCode(200)
  reprovar(@Ctx() ctx: ContextoDb, @Param('id') id: string,
           @Body(new Validar(z.object({ motivo: z.string().trim().min(5, 'Conte o motivo (pelo menos 5 letras).').max(500) }))) dto: { motivo: string }) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um(
        `UPDATE inscricao_casting SET status = 'reprovada', motivo_reprovacao = $2, analisada_por = app_usuario(), analisada_em = now()
          WHERE id = $1 AND status = 'pendente' RETURNING id`, [id, dto.motivo]);
      if (!r) throw new ConflictException({ codigo: 'ja_analisada', mensagem: 'Esta inscrição não está mais pendente.' });
      // reprovada não precisa guardar fotos (dado pessoal sem uso)
      await tx.q('DELETE FROM inscricao_casting_foto WHERE inscricao_id = $1', [id]);
      return { ok: true };
    });
  }

  /** Apaga de vez uma inscrição já analisada (pedido de exclusão de dados, limpeza da fila) */
  @Delete('inscricoes/:id')
  @Requer('M2', 'excluir')
  excluir(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um("DELETE FROM inscricao_casting WHERE id = $1 AND status <> 'pendente' RETURNING id", [id]);
      if (!r) throw new ConflictException({ codigo: 'pendente', mensagem: 'Analise a inscrição antes de excluí-la.' });
      return { ok: true };
    });
  }
}
