import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, Inject } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { DbService, ContextoDb } from '../db/db.service';
import { Avaliacao, Validar, alturaCm, uuid, dinheiro } from '../comum/validacao';
import { Ctx, Requer, Usuario, UsuarioLogado, EscopoEvento } from '../auth/decorators';
import { filtroEscopoEventos, garantirAcessoEvento } from './escopo';

const Requisitos = z.object({
  altura_min: alturaCm.optional(),
  altura_max: alturaCm.optional(),
  generos: z.array(z.string()).optional(),
  idade_min: z.number().int().optional(),
  idade_max: z.number().int().optional(),
  idiomas: z.array(z.string()).optional(),
  exige_cnh: z.boolean().optional(),
  locomocao: z.array(z.string()).optional(),
  tamanhos_camiseta: z.array(z.string()).optional(),
  nivel_min: z.number().int().min(1).max(3).optional(),
  // perfil de cabelo pedido para o posto (vazio = qualquer)
  cabelo_tipos: z.array(z.enum(['liso', 'ondulado', 'cacheado', 'crespo', 'raspado'])).optional(),
  cabelo_cores: z.array(z.enum(['preto', 'castanho', 'loiro', 'ruivo', 'grisalho', 'colorido'])).optional(),
}).default({});

const Posto = z.object({
  funcao_id: uuid,
  quantidade: z.number().int().positive(),
  diaria_custo: dinheiro,
  diaria_venda: dinheiro,
  uniforme: z.string().nullish(),
  requisitos: Requisitos,
});
const Turno = z.object({
  nome: z.string().min(2),
  inicio: z.coerce.date(),
  fim: z.coerce.date(),
  postos: z.array(Posto).default([]),
}).refine((t) => t.fim > t.inicio, { message: 'Fim do turno deve ser depois do início', path: ['fim'] });

const EventoBase = z.object({
  cliente_id: uuid,
  oportunidade_id: uuid.nullish(),
  praca_id: uuid,
  nome: z.string().min(3),
  marca: z.string().nullish(),
  descricao: z.string().nullish(),
  local_nome: z.string().nullish(),
  endereco: z.string().nullish(),
  cep: z.string().regex(/^\d{8}$/, 'CEP com 8 dígitos').nullish(),
  observacoes: z.string().max(5000).nullish(),     // texto livre: pausas, acesso, combinados
  contato_local_nome: z.string().nullish(),
  contato_local_telefone: z.string().nullish(),
  contato_local_email: z.string().email('E-mail do contato do local inválido').nullish(),
  // fora da tela de cadastro; mantidos para integrações e para o raio do check-in
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  status: z.enum(['planejamento', 'confirmado', 'em_execucao', 'encerrado', 'cancelado']).optional(),
  is_template: z.boolean().optional(),
  exige_qr: z.boolean().optional(),
  exige_geolocalizacao: z.boolean().optional(),
  raio_geo_m: z.number().int().min(50).max(5000).optional(),
  exige_selfie: z.boolean().optional(),
  tolerancia_atraso_min: z.number().int().min(0).max(120).optional(),
  checkin_antecedencia_min: z.number().int().min(0).max(600).optional(),
  metas: z.record(z.any()).optional(),
  requisitos: z.record(z.any()).optional(),
  supervisores: z.array(uuid).optional(),
});
const NovoEvento = EventoBase.extend({ turnos: z.array(Turno).default([]) });
const CAMPOS_EVENTO = Object.keys(EventoBase.shape).filter((k) => k !== 'supervisores');
const JSONB = new Set(['metas', 'requisitos']);

const FOTO_MAX = 5 * 1024 * 1024;
const NovaFoto = z.object({
  nome_arquivo: z.string().min(1).max(200),
  tipo_mime: z.enum(['image/jpeg', 'image/png', 'image/webp'], { errorMap: () => ({ message: 'Envie uma imagem JPG, PNG ou WEBP.' }) }),
  base64: z.string().min(10),
  legenda: z.string().max(300).nullish(),
});

const FiltrosEvento = z.object({
  status: z.string().optional(),
  praca: uuid.optional(),
  cliente: uuid.optional(),
  de: z.coerce.date().optional(),
  ate: z.coerce.date().optional(),
});

@Controller()
export class EventosController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get('eventos')
  @Requer('M4', 'ver')
  listar(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Query(new Validar(FiltrosEvento)) f: z.infer<typeof FiltrosEvento>) {
    const p: unknown[] = [];
    const $ = (v: unknown) => { p.push(v); return `$${p.length}`; };
    const where = ['NOT e.is_template', filtroEscopoEventos(u)];
    if (f.status) where.push(`e.status::text = ANY(string_to_array(${$(f.status)}, ','))`);
    if (f.praca) where.push(`e.praca_id = ${$(f.praca)}`);
    if (f.cliente) where.push(`e.cliente_id = ${$(f.cliente)}`);
    if (f.de) where.push(`EXISTS (SELECT 1 FROM turno t WHERE t.evento_id = e.id AND t.fim >= ${$(f.de)})`);
    if (f.ate) where.push(`EXISTS (SELECT 1 FROM turno t WHERE t.evento_id = e.id AND t.inicio <= ${$(f.ate)})`);

    return this.db.tx(ctx, (tx) =>
      tx.q(
        `SELECT e.id, e.nome, e.marca, e.status, e.local_nome, pc.nome AS praca,
                COALESCE(c.nome_fantasia, c.razao_social) AS cliente,
                (SELECT min(inicio) FROM turno WHERE evento_id = e.id) AS inicio,
                (SELECT max(fim) FROM turno WHERE evento_id = e.id) AS fim,
                COALESCE(sum(q.quantidade), 0)::int AS vagas,
                COALESCE(sum(q.confirmados), 0)::int AS confirmados,
                COALESCE(sum(GREATEST(q.vagas_abertas, 0)), 0)::int AS vagas_abertas
           FROM evento e
           JOIN praca pc ON pc.id = e.praca_id
           JOIN cliente c ON c.id = e.cliente_id
           LEFT JOIN vw_quadro_vagas q ON q.evento_id = e.id
          WHERE ${where.join(' AND ')}
          GROUP BY e.id, pc.nome, c.nome_fantasia, c.razao_social
          ORDER BY inicio NULLS LAST`,
        p,
      ),
    );
  }

  /** Quem trabalhou no evento: a nota que a empresa deu a cada um e a que cada um deu ao evento */
  @Get('eventos/:id/avaliacoes')
  @Requer('M4', 'ver')
  avaliacoes(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      await garantirAcessoEvento(tx, u, id);
      return tx.q(
        `SELECT a.id AS alocacao_id, a.profissional_id, COALESCE(pr.nome_artistico, pr.nome) AS profissional,
                f.nome AS funcao, t.nome AS turno, ap.status AS presenca, ap.checkin_em, ap.checkout_em,
                av.nota, av.observacao, av.avaliado_em, us.nome AS avaliado_por,
                ae.nota AS nota_evento, ae.comentario AS comentario_evento
           FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id
           JOIN funcao f ON f.id = p.funcao_id JOIN profissional pr ON pr.id = a.profissional_id
           JOIN apontamento ap ON ap.alocacao_id = a.id
           LEFT JOIN avaliacao av ON av.alocacao_id = a.id
           LEFT JOIN usuario us ON us.id = av.avaliado_por
           LEFT JOIN avaliacao_evento ae ON ae.evento_id = t.evento_id AND ae.profissional_id = a.profissional_id
          WHERE t.evento_id = $1 AND ap.checkin_em IS NOT NULL
          ORDER BY t.inicio, pr.nome`, [id]);
    });
  }

  /** A empresa avalia o profissional naquele trabalho (obrigatório para fechar o evento) */
  @Put('alocacoes/:id/avaliacao')
  @Requer('M5', 'editar')
  avaliar(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string,
          @Body(new Validar(Avaliacao)) dto: z.infer<typeof Avaliacao>) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const ev = await tx.um<{ evento_id: string }>(
        'SELECT t.evento_id FROM alocacao a JOIN posto p ON p.id = a.posto_id JOIN turno t ON t.id = p.turno_id WHERE a.id = $1', [id]);
      if (!ev) throw new NotFoundException({ mensagem: 'Escala não encontrada.' });
      await garantirAcessoEvento(tx, u, ev.evento_id);
      return tx.um(
        `INSERT INTO avaliacao (alocacao_id, nota, observacao, avaliado_por) VALUES ($1, $2, $3, app_usuario())
         ON CONFLICT (alocacao_id) DO UPDATE SET nota = EXCLUDED.nota, observacao = EXCLUDED.observacao,
                avaliado_por = EXCLUDED.avaliado_por, avaliado_em = now()
         RETURNING *`,
        [id, dto.nota, dto.comentario || null]);
    });
  }

  @Get('eventos/:id')
  @Requer('M4', 'ver')
  async detalhe(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string, @Req() req: any) {
    uuid.parse(id);
    const verValores = (await req.pode('M7', 'ver_valores')) || (await req.pode('M3', 'ver_valores'));
    return this.db.tx(ctx, async (tx) => {
      await garantirAcessoEvento(tx, u, id);
      const e = await tx.um(
        `SELECT e.*, pc.nome AS praca, COALESCE(c.nome_fantasia, c.razao_social) AS cliente
           FROM evento e JOIN praca pc ON pc.id = e.praca_id JOIN cliente c ON c.id = e.cliente_id
          WHERE e.id = $1`, [id]);
      if (!e) throw new NotFoundException();
      delete e.qr_segredo;
      const turnos = await tx.q(
        `SELECT t.id, t.nome, t.inicio, t.fim,
                COALESCE(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'funcao_id', p.funcao_id, 'funcao', f.nome, 'quantidade', p.quantidade,
                  'diaria_custo', CASE WHEN $2 THEN p.diaria_custo END,
                  'diaria_venda', CASE WHEN $2 THEN p.diaria_venda END,
                  'uniforme', p.uniforme, 'requisitos', p.requisitos,
                  'justificativa_vaga_aberta', p.justificativa_vaga_aberta,
                  'confirmados', q.confirmados, 'aguardando', q.aguardando, 'suplentes', q.suplentes,
                  'vagas_abertas', q.vagas_abertas) ORDER BY f.nome) FILTER (WHERE p.id IS NOT NULL), '[]') AS postos
           FROM turno t
           LEFT JOIN posto p ON p.turno_id = t.id
           LEFT JOIN funcao f ON f.id = p.funcao_id
           LEFT JOIN vw_quadro_vagas q ON q.posto_id = p.id
          WHERE t.evento_id = $1
          GROUP BY t.id ORDER BY t.inicio`, [id, verValores]);
      const checklist = await tx.q(
        `SELECT ci.*, us.nome AS responsavel FROM checklist_item ci LEFT JOIN usuario us ON us.id = ci.responsavel_id
          WHERE ci.evento_id = $1 ORDER BY ci.concluido_em NULLS FIRST, ci.prazo NULLS LAST`, [id]);
      const supervisores = await tx.q(
        `SELECT us.id, us.nome FROM evento_supervisor es JOIN usuario us ON us.id = es.usuario_id WHERE es.evento_id = $1`, [id]);
      return { ...e, turnos, checklist, supervisores, ver_valores: verValores };
    });
  }

  /** Cria evento com turnos e postos numa única operação */
  @Post('eventos')
  @Requer('M4', 'criar')
  criar(@Ctx() ctx: ContextoDb, @Body(new Validar(NovoEvento)) dto: z.infer<typeof NovoEvento>) {
    return this.db.tx(ctx, async (tx) => {
      const campos = CAMPOS_EVENTO.filter((k) => (dto as any)[k] !== undefined);
      const ev = await tx.um<{ id: string }>(
        `INSERT INTO evento (${campos.join(', ')})
         VALUES (${campos.map((k, i) => (JSONB.has(k) ? `$${i + 1}::jsonb` : `$${i + 1}`)).join(', ')}) RETURNING id`,
        campos.map((k) => (JSONB.has(k) ? JSON.stringify((dto as any)[k]) : (dto as any)[k])),
      );
      for (const t of dto.turnos) {
        const turno = await tx.um<{ id: string }>(
          'INSERT INTO turno (evento_id, nome, inicio, fim) VALUES ($1, $2, $3, $4) RETURNING id',
          [ev!.id, t.nome, t.inicio, t.fim]);
        for (const p of t.postos) await this.inserirPosto(tx, turno!.id, p);
      }
      for (const s of dto.supervisores ?? []) {
        await tx.q('INSERT INTO evento_supervisor (evento_id, usuario_id) VALUES ($1, $2)', [ev!.id, s]);
      }
      return ev;
    });
  }

  @Patch('eventos/:id')
  @Requer('M4', 'editar')
  @EscopoEvento('evento')
  editar(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(EventoBase.partial())) dto: Partial<z.infer<typeof EventoBase>>) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      // evento que já passou pelo fechamento (tem pagamento ou fatura) só muda de status pelo financeiro:
      // cancelar aqui deixaria os pagamentos pendentes e tiraria o evento da margem
      if (dto.status !== undefined) {
        const atual = await tx.um<{ status: string; tem_financeiro: boolean }>(
          `SELECT e.status, EXISTS (SELECT 1 FROM pagamento_profissional WHERE evento_id = e.id)
                         OR EXISTS (SELECT 1 FROM fatura_cliente WHERE evento_id = e.id) AS tem_financeiro
             FROM evento e WHERE e.id = $1 FOR UPDATE`, [id]);
        if (!atual) throw new NotFoundException({ mensagem: 'Evento não encontrado.' });
        if (atual.tem_financeiro && dto.status !== atual.status) {
          throw new ConflictException({ codigo: 'status_invalido', mensagem: 'Este evento já teve fechamento: o status muda pelo financeiro (fechar de novo).' });
        }
      }
      const campos = CAMPOS_EVENTO.filter((k) => (dto as any)[k] !== undefined);
      if (campos.length) {
        const r = await tx.um(
          `UPDATE evento SET ${campos.map((k, i) => `${k} = $${i + 2}${JSONB.has(k) ? '::jsonb' : ''}`).join(', ')}
            WHERE id = $1 AND status <> 'fechado' RETURNING id`,
          [id, ...campos.map((k) => (JSONB.has(k) ? JSON.stringify((dto as any)[k]) : (dto as any)[k]))]);
        if (!r) throw new NotFoundException({ mensagem: 'Evento não encontrado ou já fechado.' });
      }
      if (dto.supervisores) {
        await tx.q('DELETE FROM evento_supervisor WHERE evento_id = $1', [id]);
        for (const s of dto.supervisores) await tx.q('INSERT INTO evento_supervisor VALUES ($1, $2)', [id, s]);
      }
      return { id };
    });
  }

  @Post('eventos/:id/turnos')
  @Requer('M4', 'editar')
  @EscopoEvento('evento')
  novoTurno(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(Turno)) dto: z.infer<typeof Turno>) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const t = await tx.um<{ id: string }>('INSERT INTO turno (evento_id, nome, inicio, fim) VALUES ($1,$2,$3,$4) RETURNING id',
        [id, dto.nome, dto.inicio, dto.fim]);
      for (const p of dto.postos) await this.inserirPosto(tx, t!.id, p);
      return t;
    });
  }

  @Patch('turnos/:id')
  @Requer('M4', 'editar')
  @EscopoEvento('turno')
  editarTurno(@Ctx() ctx: ContextoDb, @Param('id') id: string,
              @Body(new Validar(z.object({ nome: z.string().optional(), inicio: z.coerce.date().optional(), fim: z.coerce.date().optional() })))
              dto: { nome?: string; inicio?: Date; fim?: Date }) {
    uuid.parse(id);
    // mudar o horário reavalia a trava de conflito de todas as alocações do turno
    return this.db.tx(ctx, (tx) =>
      tx.um(`UPDATE turno SET nome = COALESCE($2, nome), inicio = COALESCE($3, inicio), fim = COALESCE($4, fim)
              WHERE id = $1 RETURNING *`, [id, dto.nome ?? null, dto.inicio ?? null, dto.fim ?? null]),
    );
  }

  @Post('turnos/:id/postos')
  @Requer('M4', 'editar')
  @EscopoEvento('turno')
  novoPosto(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(Posto)) dto: z.infer<typeof Posto>) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) => this.inserirPosto(tx, id, dto));
  }

  @Patch('postos/:id')
  @Requer('M4', 'editar')
  @EscopoEvento('posto')
  editarPosto(@Ctx() ctx: ContextoDb, @Param('id') id: string,
              @Body(new Validar(Posto.partial().extend({ justificativa_vaga_aberta: z.string().nullish() })))
              dto: Partial<z.infer<typeof Posto>> & { justificativa_vaga_aberta?: string | null }) {
    uuid.parse(id);
    const campos = ['funcao_id', 'quantidade', 'diaria_custo', 'diaria_venda', 'uniforme', 'requisitos', 'justificativa_vaga_aberta']
      .filter((k) => (dto as any)[k] !== undefined);
    if (!campos.length) return { id };
    return this.db.tx(ctx, (tx) =>
      tx.um(`UPDATE posto SET ${campos.map((k, i) => `${k} = $${i + 2}${k === 'requisitos' ? '::jsonb' : ''}`).join(', ')}
              WHERE id = $1 RETURNING id`,
        [id, ...campos.map((k) => (k === 'requisitos' ? JSON.stringify((dto as any)[k]) : (dto as any)[k]))]),
    );
  }

  /** A maior parte dos jobs se repete: clona turnos, postos e checklist deslocando as datas */
  @Post('eventos/:id/clonar')
  @Requer('M4', 'criar')
  @EscopoEvento('evento')
  clonar(@Ctx() ctx: ContextoDb, @Param('id') id: string,
         @Body(new Validar(z.object({ novo_inicio: z.coerce.date(), nome: z.string().optional() }))) dto: { novo_inicio: Date; nome?: string }) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) => tx.um('SELECT clonar_evento($1, $2, $3) AS id', [id, dto.novo_inicio, dto.nome ?? null]));
  }

  @Post('eventos/:id/checklist')
  @Requer('M4', 'editar')
  @EscopoEvento('evento')
  novoItemChecklist(@Ctx() ctx: ContextoDb, @Param('id') id: string,
                    @Body(new Validar(z.object({ descricao: z.string().min(3), responsavel_id: uuid.nullish(), prazo: z.coerce.date().nullish() })))
                    dto: { descricao: string; responsavel_id?: string | null; prazo?: Date | null }) {
    return this.db.tx(ctx, (tx) =>
      tx.um('INSERT INTO checklist_item (evento_id, descricao, responsavel_id, prazo) VALUES ($1,$2,$3,$4) RETURNING *',
        [id, dto.descricao, dto.responsavel_id ?? null, dto.prazo ?? null]));
  }

  @Patch('checklist/:id')
  @Requer('M4', 'editar')
  @EscopoEvento('checklist')
  concluirItem(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(z.object({ concluido: z.boolean() }))) dto: { concluido: boolean }) {
    return this.db.tx(ctx, (tx) =>
      tx.um('UPDATE checklist_item SET concluido_em = CASE WHEN $2 THEN now() END WHERE id = $1 RETURNING *', [id, dto.concluido]));
  }

  // ---- fotos do local ----
  @Get('eventos/:id/fotos')
  @Requer('M4', 'ver')
  fotos(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      await garantirAcessoEvento(tx, u, id);
      return tx.q(`SELECT f.id, f.nome_arquivo, f.tipo_mime, f.tamanho, f.legenda, f.enviado_em, us.nome AS enviado_por
                     FROM evento_foto f LEFT JOIN usuario us ON us.id = f.enviado_por
                    WHERE f.evento_id = $1 ORDER BY f.enviado_em`, [id]);
    });
  }

  @Post('eventos/:id/fotos')
  @Requer('M4', 'editar')
  novaFoto(@Ctx() ctx: ContextoDb, @Usuario() u: UsuarioLogado, @Param('id') id: string, @Body(new Validar(NovaFoto)) dto: z.infer<typeof NovaFoto>) {
    uuid.parse(id);
    const conteudo = Buffer.from(dto.base64, 'base64');
    if (!conteudo.length || conteudo.length > FOTO_MAX) throw new BadRequestException({ mensagem: 'A foto deve ter até 5 MB.' });
    return this.db.tx(ctx, async (tx) => {
      await garantirAcessoEvento(tx, u, id);
      return tx.um(`INSERT INTO evento_foto (evento_id, nome_arquivo, tipo_mime, tamanho, conteudo, legenda)
                    VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, nome_arquivo, tipo_mime, tamanho, legenda, enviado_em`,
        [id, dto.nome_arquivo, dto.tipo_mime, conteudo.length, conteudo, dto.legenda ?? null]);
    });
  }

  /** A imagem em si (o painel busca com o token e mostra como blob) */
  @Get('fotos/:id')
  @Requer('M4', 'ver')
  @EscopoEvento('foto')
  async foto(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Res() res: Response) {
    uuid.parse(id);
    const f = await this.db.tx(ctx, (tx) => tx.um<{ tipo_mime: string; conteudo: Buffer }>(
      'SELECT tipo_mime, conteudo FROM evento_foto WHERE id = $1', [id]));
    if (!f) throw new NotFoundException();
    res.set({ 'Content-Type': f.tipo_mime, 'Cache-Control': 'private, max-age=86400' }).send(f.conteudo);
  }

  @Delete('fotos/:id')
  @Requer('M4', 'editar')
  @EscopoEvento('foto')
  removerFoto(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um('DELETE FROM evento_foto WHERE id = $1 RETURNING id', [id]);
      if (!r) throw new NotFoundException();
      return r;
    });
  }

  private inserirPosto(tx: any, turnoId: string, p: z.infer<typeof Posto>) {
    return tx.um(
      `INSERT INTO posto (turno_id, funcao_id, quantidade, diaria_custo, diaria_venda, uniforme, requisitos)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING id`,
      [turnoId, p.funcao_id, p.quantidade, p.diaria_custo, p.diaria_venda, p.uniforme ?? null, JSON.stringify(p.requisitos ?? {})],
    );
  }
}
