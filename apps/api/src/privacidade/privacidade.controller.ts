import { Body, Controller, ForbiddenException, Get, HttpCode, HttpException, Ip, NotFoundException, Param, Patch, Post, Query, Req, Inject } from '@nestjs/common';
import { z } from 'zod';
import { DbService, ContextoDb, Tx } from '../db/db.service';
import { config } from '../config';
import { Validar, celular, uuid } from '../comum/validacao';
import { Ctx, Publico, Usuario, UsuarioLogado } from '../auth/decorators';
import { limitar } from '../comum/limite';
import { CIFRADOS_PROFISSIONAL, decifrarCampos } from '../comum/cripto';

/**
 * LGPD: pedidos dos titulares (art. 18) e as ferramentas para atendê-los — exportar os dados
 * de um profissional (acesso e portabilidade) e excluir por anonimização.
 */
const TIPOS = ['confirmacao_acesso', 'correcao', 'exclusao', 'portabilidade', 'revogacao_consentimento', 'informacao_compartilhamento', 'oposicao'] as const;
const RELACOES = ['profissional', 'candidato_casting', 'contato_cliente', 'usuario', 'outro'] as const;
const Empresa = z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,64}$/);
// teto de pedidos por empresa em 24h, contado no banco (o limite por IP é de cada instância)
const PEDIDOS_DIA = 30;

const Solicitacao = z.object({
  tipo: z.enum(TIPOS, { errorMap: () => ({ message: 'Escolha o que você quer pedir.' }) }),
  nome: z.string().trim().min(3, 'Informe o nome completo').max(120),
  celular: celular.nullish().or(z.literal('').transform(() => null)),
  email: z.string().trim().email('E-mail inválido').max(254).nullish().or(z.literal('').transform(() => null)),
  relacao: z.enum(RELACOES),
  descricao: z.string().trim().max(2000).nullish(),
  site: z.string().max(0).optional(),   // campo escondido contra robôs
}).refine((s) => s.celular || s.email, { message: 'Informe um celular ou e-mail para receber a resposta.', path: ['celular'] });

@Publico()
@Controller('publico/titulares')
export class TitularesPublicoController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  private async empresa(slug: string) {
    const e = await this.db.tx({}, (tx) => tx.um<{ id: string; nome: string; logo: string | null }>(
      'SELECT id, nome, logo FROM titular_empresa($1)', [Empresa.parse(slug)]));
    if (!e) throw new NotFoundException({ codigo: 'empresa_nao_encontrada', mensagem: 'Empresa não encontrada. Confira o código informado.' });
    return e;
  }

  @Get(':empresa')
  async ver(@Param('empresa') slug: string, @Ip() ip: string) {
    limitar(`titular-ver:${ip}`, 30);
    const e = await this.empresa(slug);
    return { empresa: { nome: e.nome, logo: e.logo } };
  }

  @Post(':empresa')
  @HttpCode(201)
  async solicitar(@Param('empresa') slug: string, @Ip() ip: string, @Body(new Validar(Solicitacao)) dto: z.infer<typeof Solicitacao>) {
    limitar(`titular:${ip}`, 5, 60 * 60_000, 'Muitos pedidos enviados deste endereço. Tente de novo mais tarde.');
    const e = await this.empresa(slug);
    return this.db.tx({ tenantId: e.id }, async (tx) => {
      const hoje = await tx.um<{ n: number }>("SELECT count(*)::int AS n FROM solicitacao_titular WHERE criada_em > now() - interval '1 day'");
      if (hoje!.n >= PEDIDOS_DIA) {
        throw new HttpException({ codigo: 'muitas_tentativas', mensagem: 'Recebemos muitos pedidos hoje. Tente de novo amanhã ou fale direto com a empresa.' }, 429);
      }
      return tx.um<{ protocolo: string; prazo_em: Date }>(
        `INSERT INTO solicitacao_titular (tipo, nome, celular, email, relacao, descricao)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING protocolo, prazo_em`,
        [dto.tipo, dto.nome, dto.celular ?? null, dto.email ?? null, dto.relacao, dto.descricao || null]);
    });
  }
}

/**
 * Acesso e portabilidade: todos os dados do profissional em formato estruturado (JSON), com CPF, RG e Pix
 * decifrados. Só sai pelo link pessoal enviado ao celular do cadastro (ExportacaoTitularController).
 */
async function montarExportacao(tx: Tx, id: string) {
  const p = await tx.um<any>('SELECT * FROM profissional WHERE id = $1', [id]);
  if (!p) throw new NotFoundException();
  delete p.cpf_hash; delete p.tenant_id;
  decifrarCampos(p, CIFRADOS_PROFISSIONAL);
  const empresa = await tx.um('SELECT nome FROM tenant WHERE id = app_tenant()');
  return {
    gerado_em: new Date().toISOString(),
    controladora: empresa?.nome,
    dados_cadastrais: p,
    funcoes: await tx.q('SELECT f.nome, pf.nivel FROM profissional_funcao pf JOIN funcao f ON f.id = pf.funcao_id WHERE pf.profissional_id = $1', [id]),
    disponibilidade: await tx.q('SELECT dia_semana, hora_inicio, hora_fim FROM disponibilidade_semanal WHERE profissional_id = $1', [id]),
    fotos: await tx.q('SELECT nome_arquivo, tipo_mime, tamanho, enviado_em FROM profissional_foto WHERE profissional_id = $1', [id]),
    documentos: await tx.q('SELECT tipo, validade, criado_em FROM documento_profissional WHERE profissional_id = $1', [id]),
    trabalhos: await tx.q(
      `SELECT e.nome AS evento, t.inicio, t.fim, f.nome AS funcao, a.status, ap.checkin_em, ap.checkout_em
         FROM alocacao a JOIN posto po ON po.id = a.posto_id JOIN turno t ON t.id = po.turno_id JOIN evento e ON e.id = t.evento_id
         JOIN funcao f ON f.id = po.funcao_id LEFT JOIN apontamento ap ON ap.alocacao_id = a.id
        WHERE a.profissional_id = $1 ORDER BY t.inicio DESC`, [id]),
    pagamentos: (await tx.q<any>('SELECT valor, status, pago_em, chave_pix FROM pagamento_profissional WHERE profissional_id = $1 ORDER BY pago_em DESC NULLS FIRST', [id]))
      .map((x) => decifrarCampos(x, ['chave_pix'])),
  };
}

const Filtro = z.object({ status: z.enum(['aberta', 'em_andamento', 'concluida', 'recusada', 'todas']).default('todas') });
const Resposta = z.object({
  status: z.enum(['em_andamento', 'concluida', 'recusada']),
  resposta: z.string().trim().max(4000).nullish(),
}).refine((r) => r.status === 'em_andamento' || (r.resposta ?? '').length >= 10,
  { message: 'Registre a resposta dada ao titular (pelo menos 10 letras).', path: ['resposta'] });

@Controller('privacidade')
export class PrivacidadeController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  private exigirAdmin(u: UsuarioLogado) {
    if (u.perfil !== 'admin') throw new ForbiddenException({ codigo: 'somente_admin', mensagem: 'Somente a administradora atende os pedidos de LGPD.' });
  }
  /** Exportar e anonimizar mexem em CPF, RG e dados bancários: além de admin, exige a permissão DP */
  private async exigirAdminDp(u: UsuarioLogado, req: any) {
    this.exigirAdmin(u);
    if (!(await req.podeDadosPessoais())) throw new ForbiddenException({ codigo: 'sem_dados_pessoais', mensagem: 'É preciso a permissão "Dados pessoais".' });
  }

  @Get('solicitacoes')
  solicitacoes(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb, @Query(new Validar(Filtro)) f: z.infer<typeof Filtro>) {
    this.exigirAdmin(u);
    return this.db.tx(ctx, (tx) => tx.q(
      `SELECT s.*, us.nome AS respondida_por_nome, s.status IN ('aberta','em_andamento') AND s.prazo_em < now() AS atrasada
         FROM solicitacao_titular s LEFT JOIN usuario us ON us.id = s.respondida_por
        WHERE $1 = 'todas' OR s.status::text = $1
        ORDER BY s.status IN ('aberta','em_andamento') DESC, s.prazo_em, s.criada_em DESC
        LIMIT 500`, [f.status]));
  }

  @Patch('solicitacoes/:id')
  responder(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(Resposta)) dto: z.infer<typeof Resposta>) {
    this.exigirAdmin(u);
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um(
        `UPDATE solicitacao_titular SET status = $2::text::status_solicitacao_titular, resposta = COALESCE($3, resposta),
                respondida_em = CASE WHEN $2::text IN ('concluida','recusada') THEN now() END,
                respondida_por = CASE WHEN $2::text IN ('concluida','recusada') THEN app_usuario() END
          WHERE id = $1 RETURNING id`, [id, dto.status, dto.resposta || null]);
      if (!r) throw new NotFoundException();
      return r;
    });
  }

  /**
   * Envia a cópia dos dados ao titular: gera um link pessoal de 72 horas e monta a mensagem para o
   * WhatsApp do celular que JÁ ESTÁ no cadastro (nunca o informado no pedido). A administradora não
   * baixa o arquivo: assim ninguém se passa pelo profissional para receber CPF, RG e Pix.
   */
  @Post('profissionais/:id/enviar-exportacao')
  @HttpCode(200)
  async enviarExportacao(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb, @Req() req: any, @Param('id') id: string) {
    await this.exigirAdminDp(u, req);
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const p = await tx.um<{ nome: string; celular: string; empresa: string }>(
        'SELECT p.nome, p.celular, t.nome AS empresa FROM profissional p JOIN tenant t ON t.id = p.tenant_id WHERE p.id = $1', [id]);
      if (!p) throw new NotFoundException();
      const r = await tx.um<{ token: string }>('SELECT gerar_exportacao_titular($1) AS token', [id]);
      const link = `${config.appUrl}/meus-dados/${r!.token}`;
      const mensagem = `Olá, ${p.nome.split(' ')[0]}! Aqui está o link para baixar a cópia dos seus dados na ${p.empresa}, como você pediu: ${link}\n` +
        'O link vale por 72 horas e é só seu: não compartilhe.';
      const digitos = p.celular.replace(/\D/g, '');
      return {
        celular: `+${digitos.slice(0, 4)} ••••• ${digitos.slice(-4)}`,
        expira_em_horas: 72,
        whatsapp: `https://wa.me/${digitos}?text=${encodeURIComponent(mensagem)}`,
      };
    });
  }

  /** Exclusão a pedido do titular: anonimiza (mantém só o que a lei manda guardar, sem identificar a pessoa) */
  @Post('profissionais/:id/anonimizar')
  @HttpCode(200)
  async anonimizar(@Usuario() u: UsuarioLogado, @Ctx() ctx: ContextoDb, @Req() req: any, @Param('id') id: string,
                   @Body(new Validar(z.object({ confirmacao: z.literal('EXCLUIR', { errorMap: () => ({ message: 'Digite EXCLUIR para confirmar.' }) }) }))) _dto: unknown) {
    await this.exigirAdminDp(u, req);
    uuid.parse(id);
    await this.db.tx(ctx, (tx) => tx.q('SELECT anonimizar_profissional($1)', [id]));
    return { ok: true };
  }
}

/** Download da cópia dos dados pelo próprio titular, pelo link enviado ao celular do cadastro */
@Publico()
@Controller('publico/meus-dados')
export class ExportacaoTitularController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Get(':token')
  async baixar(@Param('token') token: string, @Ip() ip: string) {
    limitar(`meus-dados:${ip}`, 10);
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) throw new NotFoundException({ codigo: 'link_invalido', mensagem: 'Link inválido ou vencido.' });
    const alvo = await this.db.tx({}, (tx) => tx.um<{ tenant_id: string; profissional_id: string }>(
      'SELECT tenant_id, profissional_id FROM exportacao_por_token($1)', [token]));
    if (!alvo) throw new NotFoundException({ codigo: 'link_invalido', mensagem: 'Este link é inválido ou já venceu. Peça um novo à empresa.' });
    return this.db.tx({ tenantId: alvo.tenant_id }, (tx) => montarExportacao(tx, alvo.profissional_id));
  }
}
