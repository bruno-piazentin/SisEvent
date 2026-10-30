import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, Inject } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { Acao, Modulo, PUBLICO, REQUER, UsuarioLogado } from './decorators';

/** 1º guard: valida o JWT do usuário interno (exceto rotas @Publico). */
@Injectable()
export class AutenticacaoGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const publico = this.reflector.getAllAndOverride<boolean>(PUBLICO, [ctx.getHandler(), ctx.getClass()]);
    if (publico) return true;

    const req = ctx.switchToHttp().getRequest();
    const cabecalho: string | undefined = req.headers.authorization;
    if (!cabecalho?.startsWith('Bearer ')) throw new UnauthorizedException({ codigo: 'nao_autenticado' });
    try {
      const p = jwt.verify(cabecalho.slice(7), config.jwtSegredo) as any;
      // master só vale enquanto ele estiver configurado no ambiente
      const master = !!p.master && !!config.master;
      req.usuario = { id: p.sub, tenantId: p.tid, nome: p.nome, perfil: p.perfil, master } satisfies UsuarioLogado;
      return true;
    } catch {
      throw new UnauthorizedException({ codigo: 'sessao_expirada', mensagem: 'Sessão expirada. Entre novamente.' });
    }
  }
}

/**
 * 2º guard: liberação por módulo. A regra está no banco (tem_permissao), então a mesma
 * decisão vale para API, menu e BI. Bloquear só na tela não é segurança.
 */
@Injectable()
export class ModuloGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector, @Inject(DbService) private readonly db: DbService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    // helper disponível nos controllers para checagens condicionais (ex.: mostrar valores)
    req.pode = (modulo: Modulo, acao: Acao) => this.pode(req.usuario, modulo, acao, req);

    const exige = this.reflector.getAllAndOverride<{ modulo: Modulo; acao: Acao }>(REQUER, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!exige) return true;
    if (!req.usuario) throw new ForbiddenException();

    if (!(await this.pode(req.usuario, exige.modulo, exige.acao, req))) {
      throw new ForbiddenException({
        codigo: 'modulo_nao_liberado',
        mensagem: `Sem acesso a ${exige.modulo} (${exige.acao}). Verifique a liberação do módulo ou suas permissões.`,
      });
    }
    return true;
  }

  private async pode(u: UsuarioLogado | undefined, modulo: Modulo, acao: Acao, req: any): Promise<boolean> {
    if (!u) return false;
    req._permissoes ??= new Map<string, boolean>();
    const chave = `${modulo}:${acao}`;
    if (!req._permissoes.has(chave)) {
      const r = await this.db.tx({ tenantId: u.tenantId, usuarioId: u.id }, (tx) =>
        tx.um<{ ok: boolean }>('SELECT tem_permissao($1, $2, $3::acao_permissao) AS ok', [u.id, modulo, acao]),
      );
      req._permissoes.set(chave, !!r?.ok);
    }
    return req._permissoes.get(chave);
  }
}
