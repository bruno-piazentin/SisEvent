import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Converte erros do Postgres em respostas HTTP claras.
 * As regras de negócio vivem no banco (trava de conflito, lotação, fechamento...),
 * então os códigos SQLSTATE abaixo são o "contrato" entre banco e API.
 */
const MAPA_PG: Record<string, { status: number; codigo: string; mensagem?: string }> = {
  '23P01': { status: 409, codigo: 'conflito_horario', mensagem: 'Esta pessoa já está escalada em outro evento neste horário.' },
  '23505': { status: 409, codigo: 'duplicado', mensagem: 'Registro duplicado.' },
  '23503': { status: 422, codigo: 'referencia_invalida', mensagem: 'Registro relacionado não encontrado.' },
  '23514': { status: 422, codigo: 'valor_invalido' },
  '22P02': { status: 400, codigo: 'formato_invalido', mensagem: 'Identificador ou valor em formato inválido.' },
  '42501': { status: 403, codigo: 'sem_permissao', mensagem: 'Operação não permitida.' },
  P0001: { status: 409, codigo: 'posto_lotado' },
  P0002: { status: 423, codigo: 'evento_fechado' },
  P0003: { status: 422, codigo: 'profissional_indisponivel' },
  P0004: { status: 422, codigo: 'justificativa_obrigatoria' },
  P0005: { status: 409, codigo: 'alocacao_nao_confirmada' },
  P0006: { status: 409, codigo: 'status_invalido' },
  P0007: { status: 409, codigo: 'fechamento_bloqueado' },
  P0008: { status: 409, codigo: 'pagamento_enviado' },
  P0009: { status: 422, codigo: 'horario_invalido' },
  P0010: { status: 422, codigo: 'referencia_invalida' },
};

// Duplicidade com mensagem própria, pelo nome da restrição
const DUPLICADOS: Record<string, string> = {
  profissional_cpf_unico: 'Já existe um profissional com este CPF.',
  profissional_tenant_id_celular_key: 'Já existe um profissional com este celular.',
};

@Catch()
export class ErrosFilter implements ExceptionFilter {
  private readonly log = new Logger('Erro');

  catch(erro: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (erro instanceof HttpException) {
      const corpo = erro.getResponse();
      return res.status(erro.getStatus()).json(typeof corpo === 'string' ? { mensagem: corpo } : corpo);
    }
    if (erro instanceof ZodError) {
      return res.status(400).json({
        codigo: 'validacao',
        mensagem: 'Dados inválidos.',
        campos: erro.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message })),
      });
    }
    const pg = erro?.code && MAPA_PG[erro.code];
    if (pg) {
      return res.status(pg.status).json({
        codigo: pg.codigo,
        mensagem: (erro.code === '23505' && DUPLICADOS[erro.constraint]) || pg.mensagem || erro.message,
        dica: erro.hint,
      });
    }
    this.log.error(erro?.stack ?? erro);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ codigo: 'erro_interno', mensagem: 'Erro inesperado.' });
  }
}
