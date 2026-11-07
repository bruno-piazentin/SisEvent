import { BadRequestException, Body, ConflictException, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Patch, Post, Query,
  Req, ServiceUnavailableException, Inject } from '@nestjs/common';
import { z } from 'zod';
import { DbService, ContextoDb } from '../db/db.service';
import { DadosCadastrais, Validar, cnpjValido, cpfValido, uuid } from '../comum/validacao';
import { Ctx, Requer } from '../auth/decorators';

const TIPOS_CLIENTE = ['agencia', 'produtora', 'industria', 'representante', 'revenda', 'supermercado', 'outro'] as const;

const Cliente = DadosCadastrais.extend({
  tipo: z.enum(TIPOS_CLIENTE).default('outro'),
  // marcas que a empresa representa / vende — gravadas no catálogo "marca"
  marcas: z.array(z.string().trim().min(1).max(80)).max(200).optional(),
  agencia_id: uuid.nullish(),
  cor_primaria: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish(),
  logo_url: z.string().url().nullish(),
  prazo_pagamento_dias: z.number().int().min(0).max(180).default(30),
  ativo: z.boolean().optional(),
  contatos: z.array(z.lazy(() => Colaborador)).optional(),
});
const CAMPOS_CLIENTE = ['pessoa', 'razao_social', 'nome_fantasia', 'cnpj', 'cpf', 'tipo', 'agencia_id', 'cor_primaria', 'logo_url', 'prazo_pagamento_dias',
  'telefone', 'email', 'redes_sociais', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'ativo'];

/** Colaborador (agente) da empresa cliente — a base de contato */
const Colaborador = z.object({
  nome: z.string().min(2, 'Informe o nome'),
  sobrenome: z.string().nullish(),
  apelido: z.string().nullish(),
  cargo: z.string().nullish(),
  email: z.string().email('E-mail do colaborador inválido').nullish(),
  telefone: z.string().nullish(),
  principal: z.boolean().default(false),
  ativo: z.boolean().optional(),
});
const CAMPOS_COLABORADOR = ['nome', 'sobrenome', 'apelido', 'cargo', 'email', 'telefone', 'principal', 'ativo'];

const Ocorrencia = z.object({ texto: z.string().trim().min(3, 'Descreva a ocorrência').max(5000) });

const CEP_VALIDADE_DIAS = 180;

/** Marcas do cliente "c" em ordem alfabética (subconsulta usada na lista e na ficha) */
const SQL_MARCAS_CLIENTE = `COALESCE((SELECT array_agg(m.nome ORDER BY m.nome) FROM cliente_marca cm JOIN marca m ON m.id = cm.marca_id
                                       WHERE cm.cliente_id = c.id), '{}')`;

/** Consulta a base de CEP dos Correios pelos serviços públicos que a replicam (ViaCEP e, se falhar, BrasilAPI) */
async function consultarCorreios(cep: string) {
  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(6000) });
    if (r.ok) {
      const d: any = await r.json();
      if (d.erro) return null;
      return { logradouro: d.logradouro || null, complemento: d.complemento || null, bairro: d.bairro || null,
               cidade: d.localidade, uf: d.uf, ibge: d.ibge || null, fonte: 'viacep' };
    }
  } catch { /* tenta a próxima fonte */ }
  const r = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`, { signal: AbortSignal.timeout(6000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new ServiceUnavailableException({ mensagem: 'Serviço de CEP indisponível. Preencha o endereço manualmente.' });
  const d: any = await r.json();
  return { logradouro: d.street || null, complemento: null, bairro: d.neighborhood || null,
           cidade: d.city, uf: d.state, ibge: null, fonte: 'brasilapi' };
}

/** Cadastros de apoio: praças, funções e clientes (M3) */
@Controller()
export class CadastrosController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  // Praças e funções são consultadas por todos os módulos operacionais
  @Get('pracas')
  pracas(@Ctx() ctx: ContextoDb) {
    return this.db.tx(ctx, (tx) => tx.q('SELECT id, nome, uf FROM praca ORDER BY nome'));
  }

  @Post('pracas')
  @Requer('M4', 'criar')
  novaPraca(@Ctx() ctx: ContextoDb, @Body(new Validar(z.object({ nome: z.string().min(2), uf: z.string().length(2) }))) dto: { nome: string; uf: string }) {
    return this.db.tx(ctx, (tx) => tx.um('INSERT INTO praca (nome, uf) VALUES ($1, upper($2)) RETURNING *', [dto.nome, dto.uf]));
  }

  @Get('funcoes')
  funcoes(@Ctx() ctx: ContextoDb) {
    return this.db.tx(ctx, (tx) => tx.q('SELECT id, codigo, nome FROM funcao ORDER BY nome'));
  }

  @Post('funcoes')
  @Requer('M1', 'criar')
  novaFuncao(@Ctx() ctx: ContextoDb, @Body(new Validar(z.object({ codigo: z.string().regex(/^[a-z_]+$/), nome: z.string() }))) dto: { codigo: string; nome: string }) {
    return this.db.tx(ctx, (tx) => tx.um('INSERT INTO funcao (codigo, nome) VALUES ($1, $2) RETURNING *', [dto.codigo, dto.nome]));
  }

  /** CEP: primeiro na tabela local; se não houver (ou estiver velho), busca na base dos Correios e guarda */
  @Get('cep/:cep')
  async cep(@Ctx() ctx: ContextoDb, @Param('cep') bruto: string) {
    const cep = bruto.replace(/\D/g, '');
    if (!/^\d{8}$/.test(cep)) throw new NotFoundException({ mensagem: 'CEP deve ter 8 dígitos.' });
    const local = await this.db.tx(ctx, (tx) =>
      tx.um(`SELECT * FROM cep WHERE cep = $1 AND consultado_em > now() - make_interval(days => $2)`, [cep, CEP_VALIDADE_DIAS]));
    if (local) return local;
    const achado = await consultarCorreios(cep);
    if (!achado) throw new NotFoundException({ mensagem: 'CEP não encontrado na base dos Correios.' });
    return this.db.tx(ctx, (tx) =>
      tx.um(`INSERT INTO cep (cep, logradouro, complemento, bairro, cidade, uf, ibge, fonte)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (cep) DO UPDATE SET logradouro = EXCLUDED.logradouro, complemento = EXCLUDED.complemento,
               bairro = EXCLUDED.bairro, cidade = EXCLUDED.cidade, uf = EXCLUDED.uf, ibge = EXCLUDED.ibge,
               fonte = EXCLUDED.fonte, consultado_em = now()
             RETURNING *`,
        [cep, achado.logradouro, achado.complemento, achado.bairro, achado.cidade, achado.uf, achado.ibge, achado.fonte]));
  }

  /** Latitude/longitude a partir do endereço (OpenStreetMap / Nominatim), para o raio do check-in */
  @Get('geolocalizacao')
  @Requer('M4', 'ver')
  async geolocalizar(@Query('endereco') endereco?: string) {
    const q = (endereco ?? '').trim();
    if (q.length < 5) throw new BadRequestException({ mensagem: 'Preencha o endereço do evento antes de buscar a geolocalização.' });
    const url = `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'json', limit: '1', countrycodes: 'br', addressdetails: '0' })}`;
    let r: Response;
    try {
      // a política do Nominatim exige identificar a aplicação
      r = await fetch(url, { headers: { 'User-Agent': 'SisEvent/1.0 (gestao de eventos)', 'Accept-Language': 'pt-BR' }, signal: AbortSignal.timeout(8000) });
    } catch {
      throw new ServiceUnavailableException({ mensagem: 'Serviço de mapas indisponível. Tente de novo ou use "Minha localização atual".' });
    }
    if (!r.ok) throw new ServiceUnavailableException({ mensagem: 'Serviço de mapas indisponível. Tente de novo ou use "Minha localização atual".' });
    const [achado]: any[] = await r.json();
    if (!achado) throw new NotFoundException({ mensagem: 'Endereço não localizado no mapa. Confira número, cidade e UF, ou use "Minha localização atual".' });
    return { latitude: Number(Number(achado.lat).toFixed(6)), longitude: Number(Number(achado.lon).toFixed(6)), descricao: achado.display_name, fonte: 'openstreetmap' };
  }

  @Get('clientes')
  @Requer('M3', 'ver')
  async clientes(@Ctx() ctx: ContextoDb, @Req() req: any, @Query('marca') marca?: string) {
    const verCpf = await req.podeDadosPessoais();
    const lista = await this.db.tx(ctx, (tx) =>
      tx.q(`SELECT c.id, c.pessoa, c.razao_social, c.nome_fantasia, c.cnpj, c.cpf, c.tipo, c.ativo, ag.nome_fantasia AS agencia,
                   c.telefone, c.email, c.redes_sociais, c.cep, c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf, c.prazo_pagamento_dias,
                   (SELECT count(*) FROM cliente_contato ct WHERE ct.cliente_id = c.id AND ct.ativo)::int AS colaboradores,
                   (SELECT count(*) FROM evento e WHERE e.cliente_id = c.id AND NOT e.is_template)::int AS eventos,
                   (SELECT max(t.inicio) FROM evento e JOIN turno t ON t.evento_id = e.id WHERE e.cliente_id = c.id) AS ultimo_evento,
                   ${SQL_MARCAS_CLIENTE} AS marcas
              FROM cliente c LEFT JOIN cliente ag ON ag.id = c.agencia_id
             WHERE c.excluido_em IS NULL
               AND ($1::text IS NULL OR EXISTS (
                     SELECT 1 FROM cliente_marca cm JOIN marca m ON m.id = cm.marca_id
                      WHERE cm.cliente_id = c.id AND m.nome_busca LIKE '%' || trim(normalizar_busca($1)) || '%'))
             ORDER BY c.ativo DESC, COALESCE(c.nome_fantasia, c.razao_social)`, [marca?.trim() || null]),
    );
    // CPF de cliente pessoa física é dado pessoal (permissão DP); o CNPJ é público e continua visível
    if (!verCpf) for (const c of lista) delete c.cpf;
    return lista;
  }

  /** Catálogo de marcas (autocompletar e busca por marca), com quantos clientes representam cada uma */
  @Get('marcas')
  @Requer('M3', 'ver')
  marcas(@Ctx() ctx: ContextoDb, @Query('q') q?: string) {
    return this.db.tx(ctx, (tx) =>
      tx.q(`SELECT m.id, m.nome, count(cm.cliente_id)::int AS clientes,
                   COALESCE(array_agg(COALESCE(c.nome_fantasia, c.razao_social) ORDER BY c.nome_fantasia)
                            FILTER (WHERE c.id IS NOT NULL), '{}') AS nomes_clientes
              FROM marca m
              LEFT JOIN cliente_marca cm ON cm.marca_id = m.id
                    AND EXISTS (SELECT 1 FROM cliente x WHERE x.id = cm.cliente_id AND x.excluido_em IS NULL)
              LEFT JOIN cliente c ON c.id = cm.cliente_id
             WHERE ($1::text IS NULL OR m.nome_busca LIKE '%' || trim(normalizar_busca($1)) || '%')
             GROUP BY m.id ORDER BY m.nome LIMIT 200`, [q?.trim() || null]));
  }

  @Get('clientes/:id')
  @Requer('M3', 'ver')
  async cliente(@Ctx() ctx: ContextoDb, @Req() req: any, @Param('id') id: string) {
    uuid.parse(id);
    const verCpf = await req.podeDadosPessoais();
    return this.db.tx(ctx, async (tx) => {
      const c = await tx.um(
        `SELECT c.*, u.nome AS status_alterado_por FROM cliente c
           LEFT JOIN LATERAL (SELECT us.nome FROM auditoria a JOIN usuario us ON us.id = a.usuario_id
                               WHERE a.tabela = 'cliente' AND a.registro_id = c.id AND a.operacao = 'U' AND a.alterado ? 'ativo'
                               ORDER BY a.em DESC LIMIT 1) u ON true
          WHERE c.id = $1 AND c.excluido_em IS NULL`, [id]);
      if (!c) throw new NotFoundException({ mensagem: 'Cliente não encontrado ou excluído.' });
      if (!verCpf) { delete c.cpf; c.ocultos = ['cpf']; }
      c.agencia = c.agencia_id ? (await tx.um('SELECT COALESCE(nome_fantasia, razao_social) AS nome FROM cliente WHERE id = $1', [c.agencia_id]))?.nome : null;
      c.contatos = await tx.q('SELECT * FROM cliente_contato WHERE cliente_id = $1 ORDER BY ativo DESC, principal DESC, nome, sobrenome', [id]);
      c.marcas = (await tx.um(`SELECT ${SQL_MARCAS_CLIENTE} AS marcas FROM cliente c WHERE c.id = $1`, [id]))!.marcas;
      c.eventos = await tx.q(
        `SELECT e.id, e.nome, e.marca, e.status, e.local_nome, pc.nome AS praca,
                (SELECT min(inicio) FROM turno WHERE evento_id = e.id) AS inicio,
                (SELECT max(fim) FROM turno WHERE evento_id = e.id) AS fim,
                COALESCE(sum(q.quantidade), 0)::int AS vagas,
                COALESCE(sum(q.confirmados), 0)::int AS confirmados
           FROM evento e
           JOIN praca pc ON pc.id = e.praca_id
           LEFT JOIN vw_quadro_vagas q ON q.evento_id = e.id
          WHERE e.cliente_id = $1 AND NOT e.is_template
          GROUP BY e.id, pc.nome ORDER BY inicio DESC NULLS LAST`, [id]);
      return c;
    });
  }

  @Post('clientes')
  @Requer('M3', 'criar')
  async novoCliente(@Ctx() ctx: ContextoDb, @Req() req: any, @Body(new Validar(Cliente)) dto: z.infer<typeof Cliente>) {
    if (!(await req.podeDadosPessoais())) delete dto.cpf;
    return this.db.tx(ctx, async (tx) => {
      await this.conferirDocumento(tx, dto);
      const campos = CAMPOS_CLIENTE.filter((k) => (dto as any)[k] !== undefined);
      const c = await tx.um<{ id: string }>(
        `INSERT INTO cliente (${campos.join(', ')}) VALUES (${campos.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        campos.map((k) => (dto as any)[k]),
      );
      for (const ct of dto.contatos ?? []) await this.inserirColaborador(tx, c!.id, ct);
      if (dto.marcas) await this.gravarMarcas(tx, c!.id, dto.marcas);
      return c;
    });
  }

  @Patch('clientes/:id')
  @Requer('M3', 'editar')
  async editarCliente(@Ctx() ctx: ContextoDb, @Req() req: any, @Param('id') id: string, @Body(new Validar(Cliente.partial())) dto: Partial<z.infer<typeof Cliente>>) {
    uuid.parse(id);
    const podeDP = await req.podeDadosPessoais();
    if (!podeDP) delete dto.cpf;   // sem a permissão, o CPF gravado não muda
    return this.db.tx(ctx, async (tx) => {
      await this.conferirDocumento(tx, dto, id, podeDP);
      const campos = CAMPOS_CLIENTE.filter((k) => (dto as any)[k] !== undefined);
      const sets = campos.map((k, i) => `${k} = $${i + 2}`);
      if (dto.ativo !== undefined) sets.push(`status_alterado_em = CASE WHEN ativo IS DISTINCT FROM $${campos.indexOf('ativo') + 2} THEN now() ELSE status_alterado_em END`);
      const r = sets.length
        ? await tx.um(`UPDATE cliente SET ${sets.join(', ')} WHERE id = $1 AND excluido_em IS NULL RETURNING id`,
            [id, ...campos.map((k) => (dto as any)[k])])
        : { id };
      if (!r) throw new NotFoundException();
      if (dto.marcas) await this.gravarMarcas(tx, id, dto.marcas);
      return r;
    });
  }

  /** Exclusão lógica: some das telas, mas continua na base (recuperável pelo CNPJ/CPF) */
  @Delete('clientes/:id')
  @Requer('M3', 'excluir')
  excluirCliente(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um(`UPDATE cliente SET excluido_em = now(), excluido_por = app_usuario()
                              WHERE id = $1 AND excluido_em IS NULL RETURNING id`, [id]);
      if (!r) throw new NotFoundException({ mensagem: 'Cliente não encontrado ou já excluído.' });
      return r;
    });
  }

  /** Localiza clientes excluídos pelo CNPJ ou CPF */
  @Get('clientes-excluidos')
  @Requer('M3', 'excluir')
  excluidos(@Ctx() ctx: ContextoDb, @Query('documento') documento?: string) {
    const doc = (documento ?? '').replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) throw new BadRequestException({ mensagem: 'Informe o CPF (11 dígitos) ou o CNPJ (14 dígitos).' });
    return this.db.tx(ctx, (tx) =>
      tx.q(`SELECT c.id, c.pessoa, c.razao_social, c.nome_fantasia, c.cnpj, c.cpf, c.tipo, c.cidade, c.uf,
                   c.excluido_em, u.nome AS excluido_por,
                   (SELECT count(*) FROM evento e WHERE e.cliente_id = c.id AND NOT e.is_template)::int AS eventos
              FROM cliente c LEFT JOIN usuario u ON u.id = c.excluido_por
             WHERE c.excluido_em IS NOT NULL AND (c.cnpj = $1 OR c.cpf = $1)`, [doc]));
  }

  @Post('clientes/:id/recuperar')
  @Requer('M3', 'excluir')
  recuperarCliente(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um(`UPDATE cliente SET excluido_em = NULL, excluido_por = NULL
                              WHERE id = $1 AND excluido_em IS NOT NULL RETURNING id`, [id]);
      if (!r) throw new NotFoundException({ mensagem: 'Nenhum cliente excluído com este identificador.' });
      return r;
    });
  }

  /**
   * Pessoa jurídica usa CNPJ, pessoa física usa CPF (o outro é apagado).
   * Confere os dígitos e a duplicidade — inclusive com excluídos, que devem ser recuperados, não recadastrados.
   */
  private async conferirDocumento(tx: any, dto: Partial<z.infer<typeof Cliente>>, id?: string, podeDP = true) {
    const atual = id ? await tx.um('SELECT pessoa, cnpj, cpf FROM cliente WHERE id = $1 AND excluido_em IS NULL', [id]) : null;
    if (id && !atual) throw new NotFoundException({ mensagem: 'Cliente não encontrado ou excluído.' });
    const pessoa = dto.pessoa ?? atual?.pessoa ?? 'juridica';
    const [coluna, rotulo, valido] = pessoa === 'fisica' ? ['cpf', 'CPF', cpfValido] as const : ['cnpj', 'CNPJ', cnpjValido] as const;
    if (pessoa === 'fisica') dto.cnpj = null;
    else {
      // virar pessoa jurídica apaga o CPF gravado: apagar também é mexer em dado pessoal
      if (!podeDP && atual?.cpf) {
        throw new ForbiddenException({ codigo: 'sem_dados_pessoais', mensagem: 'Mudar para pessoa jurídica apaga o CPF: é preciso a permissão "Dados pessoais".' });
      }
      dto.cpf = null;
    }
    const doc = dto[coluna];
    if (!doc) return;
    // documento antigo que não mudou não é revalidado (cadastros anteriores à validação)
    if ((!atual || doc !== atual[coluna]) && !valido(doc)) {
      throw new BadRequestException({ codigo: 'validacao', mensagem: `${rotulo} inválido: confira os dígitos.`, campos: [{ campo: coluna, mensagem: `${rotulo} inválido` }] });
    }
    const outro = await tx.um(
      `SELECT COALESCE(nome_fantasia, razao_social) AS nome, excluido_em FROM cliente WHERE ${coluna} = $1 AND id IS DISTINCT FROM $2`,
      [doc, id ?? null]);
    if (outro) {
      throw new ConflictException(outro.excluido_em
        ? { codigo: 'cliente_excluido', mensagem: `Já existe um cliente excluído com este ${rotulo} (${outro.nome}). Use "Recuperar exclusão" para trazê-lo de volta.` }
        : { codigo: 'duplicado', mensagem: `Já existe um cliente com este ${rotulo}: ${outro.nome}.` });
    }
  }

  /** Substitui as marcas do cliente; marcas novas entram no catálogo (sem duplicar por acento/maiúscula) */
  private async gravarMarcas(tx: any, clienteId: string, marcas: string[]) {
    const nomes = [...new Set(marcas.map((m) => m.trim().replace(/\s+/g, ' ')).filter(Boolean))];
    await tx.q('DELETE FROM cliente_marca WHERE cliente_id = $1', [clienteId]);
    if (!nomes.length) return;
    // nome_busca é calculado pelo trigger antes da checagem de duplicidade
    await tx.q(`INSERT INTO marca (nome, nome_busca) SELECT n, '' FROM unnest($1::text[]) n
                ON CONFLICT (tenant_id, nome_busca) DO NOTHING`, [nomes]);
    await tx.q(`INSERT INTO cliente_marca (cliente_id, marca_id)
                SELECT $1, m.id FROM marca m
                 WHERE m.nome_busca IN (SELECT trim(normalizar_busca(n)) FROM unnest($2::text[]) n)
                ON CONFLICT DO NOTHING`, [clienteId, nomes]);
  }

  // ---- colaboradores (agentes) da empresa cliente ----
  @Post('clientes/:id/contatos')
  @Requer('M3', 'editar')
  novoColaborador(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(Colaborador)) dto: z.infer<typeof Colaborador>) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      if (!(await tx.um('SELECT id FROM cliente WHERE id = $1', [id]))) throw new NotFoundException();
      return this.inserirColaborador(tx, id, dto);
    });
  }

  @Patch('contatos/:id')
  @Requer('M3', 'editar')
  editarColaborador(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(Colaborador.partial())) dto: Partial<z.infer<typeof Colaborador>>) {
    uuid.parse(id);
    const campos = CAMPOS_COLABORADOR.filter((k) => (dto as any)[k] !== undefined);
    if (!campos.length) return { id };
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um(`UPDATE cliente_contato SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
        [id, ...campos.map((k) => (dto as any)[k])]);
      if (!r) throw new NotFoundException();
      if (dto.principal) await tx.q('UPDATE cliente_contato SET principal = false WHERE cliente_id = $1 AND id <> $2', [r.cliente_id, id]);
      return r;
    });
  }

  @Delete('contatos/:id')
  @Requer('M3', 'editar')
  removerColaborador(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, async (tx) => {
      const r = await tx.um('DELETE FROM cliente_contato WHERE id = $1 RETURNING id', [id]);
      if (!r) throw new NotFoundException();
      return r;
    });
  }

  // ---- ocorrências dos cadastros (texto livre, só inclusão) ----
  @Get('clientes/:id/ocorrencias')
  @Requer('M3', 'ver')
  ocorrenciasCliente(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    return this.listarOcorrencias(ctx, 'cliente_id', id);
  }

  @Post('clientes/:id/ocorrencias')
  @Requer('M3', 'editar')
  novaOcorrenciaCliente(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(Ocorrencia)) dto: z.infer<typeof Ocorrencia>) {
    return this.registrarOcorrencia(ctx, 'cliente_id', id, dto.texto);
  }

  @Get('profissionais/:id/ocorrencias')
  @Requer('M1', 'ver')
  ocorrenciasProfissional(@Ctx() ctx: ContextoDb, @Param('id') id: string) {
    return this.listarOcorrencias(ctx, 'profissional_id', id);
  }

  @Post('profissionais/:id/ocorrencias')
  @Requer('M1', 'editar')
  novaOcorrenciaProfissional(@Ctx() ctx: ContextoDb, @Param('id') id: string, @Body(new Validar(Ocorrencia)) dto: z.infer<typeof Ocorrencia>) {
    return this.registrarOcorrencia(ctx, 'profissional_id', id, dto.texto);
  }

  private listarOcorrencias(ctx: ContextoDb, coluna: 'cliente_id' | 'profissional_id', id: string) {
    uuid.parse(id);
    return this.db.tx(ctx, (tx) =>
      tx.q(`SELECT o.id, o.texto, o.registrado_em, us.nome AS registrado_por
              FROM ocorrencia_cadastro o LEFT JOIN usuario us ON us.id = o.registrado_por
             WHERE o.${coluna} = $1 ORDER BY o.registrado_em DESC`, [id]));
  }

  private registrarOcorrencia(ctx: ContextoDb, coluna: 'cliente_id' | 'profissional_id', id: string, texto: string) {
    uuid.parse(id);
    const tabela = coluna === 'cliente_id' ? 'cliente' : 'profissional';
    return this.db.tx(ctx, async (tx) => {
      if (!(await tx.um(`SELECT id FROM ${tabela} WHERE id = $1`, [id]))) throw new NotFoundException();
      return tx.um(`INSERT INTO ocorrencia_cadastro (${coluna}, texto) VALUES ($1, $2) RETURNING id, texto, registrado_em`, [id, texto]);
    });
  }

  private async inserirColaborador(tx: any, clienteId: string, ct: z.infer<typeof Colaborador>) {
    // só um contato principal por cliente
    if (ct.principal) await tx.q('UPDATE cliente_contato SET principal = false WHERE cliente_id = $1', [clienteId]);
    return tx.um(
      `INSERT INTO cliente_contato (cliente_id, nome, sobrenome, apelido, cargo, email, telefone, principal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [clienteId, ct.nome, ct.sobrenome ?? null, ct.apelido ?? null, ct.cargo ?? null, ct.email ?? null, ct.telefone ?? null, ct.principal]);
  }
}
