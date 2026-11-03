import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export type Modulo = 'M1' | 'M2' | 'M3' | 'M4' | 'M5' | 'M6' | 'M7' | 'M8' | 'M9' | 'BI' | 'DP';  // DP: dados pessoais (não é tela, só permissão)
export type Acao = 'ver' | 'criar' | 'editar' | 'excluir' | 'aprovar' | 'ver_valores';

export interface UsuarioLogado {
  id: string;
  tenantId: string;
  nome: string;
  perfil: string; // admin | central | supervisor | financeiro
  master?: boolean; // usuário master de manutenção: acessa o cadastro de empresas
}

export const PUBLICO = 'publico';
export const REQUER = 'requer';

/** Rota sem login (área do profissional por link, formulário público, health check). */
export const Publico = () => SetMetadata(PUBLICO, true);

/**
 * Exige módulo liberado para a empresa + permissão do usuário.
 * Ex.: @Requer('M5', 'editar')
 */
export const Requer = (modulo: Modulo, acao: Acao = 'ver') => SetMetadata(REQUER, { modulo, acao });

export const Usuario = createParamDecorator((_: unknown, ctx: ExecutionContext): UsuarioLogado => {
  return ctx.switchToHttp().getRequest().usuario;
});

/** Contexto pronto para DbService.tx() */
export const Ctx = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest();
  const u: UsuarioLogado | undefined = req.usuario;
  return {
    tenantId: u?.tenantId,
    usuarioId: u?.id,
    motivo: (req.headers['x-motivo'] as string | undefined)?.slice(0, 500),
  };
});
