import { Body, Controller, Get, HttpCode, Post, UnauthorizedException, Inject } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { Validar } from '../comum/validacao';
import { Publico, Usuario, UsuarioLogado } from './decorators';

const Login = z.object({
  empresa: z.string().min(2),          // slug da empresa: "rafadutra"
  email: z.string().email(),
  senha: z.string().min(6),
});

@Controller('auth')
export class AuthController {
  constructor(@Inject(DbService) private readonly db: DbService) {}

  @Publico()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new Validar(Login)) dto: z.infer<typeof Login>) {
    const u = config.master && dto.email.toLowerCase() === config.master.email
      ? await this.loginMaster(dto)
      : await this.loginComum(dto);
    // mesma mensagem para usuário inexistente e senha errada (não revela quem tem conta)
    if (!u) throw new UnauthorizedException({ codigo: 'credenciais_invalidas', mensagem: 'E-mail ou senha incorretos.' });

    await this.db.tx({ tenantId: u.tenant_id, usuarioId: u.id }, (tx) =>
      tx.q('UPDATE usuario SET ultimo_acesso = now() WHERE id = $1', [u.id]),
    );
    const token = jwt.sign({ sub: u.id, tid: u.tenant_id, nome: u.nome, perfil: u.perfil }, config.jwtSegredo, {
      expiresIn: config.jwtValidade as jwt.SignOptions['expiresIn'],
    });
    return { token, usuario: { id: u.id, nome: u.nome, perfil: u.perfil } };
  }

  private async loginComum(dto: z.infer<typeof Login>) {
    const u = await this.db.tx({}, (tx) =>
      tx.um('SELECT * FROM buscar_usuario_login($1, $2)', [dto.email, dto.empresa]),
    );
    const ok = u?.ativo && u.senha_hash && (await bcrypt.compare(dto.senha, u.senha_hash));
    return ok ? u : undefined;
  }

  /**
   * Master de manutenção: a senha é conferida com o hash do ambiente, não com o banco.
   * Na empresa escolhida ele vira (ou continua) um usuário admin comum, então permissões,
   * RLS e auditoria funcionam como para qualquer outro usuário.
   */
  private async loginMaster(dto: z.infer<typeof Login>) {
    const master = config.master!;
    if (!(await bcrypt.compare(dto.senha, master.senhaHash))) return undefined;
    const t = await this.db.tx({}, (tx) =>
      tx.um<{ id: string | null }>('SELECT tenant_por_slug($1) AS id', [dto.empresa]));
    if (!t?.id) return undefined;
    return this.db.tx({ tenantId: t.id }, async (tx) => {
      await tx.q(
        `INSERT INTO usuario (perfil_id, nome, email, senha_hash)
         SELECT p.id, $1, $2, $3 FROM perfil_acesso p WHERE p.codigo = 'admin'
         ON CONFLICT (tenant_id, email) DO UPDATE
            SET perfil_id = EXCLUDED.perfil_id, nome = EXCLUDED.nome, senha_hash = EXCLUDED.senha_hash, ativo = true
          WHERE (usuario.perfil_id, usuario.nome, usuario.senha_hash, usuario.ativo)
                IS DISTINCT FROM (EXCLUDED.perfil_id, EXCLUDED.nome, EXCLUDED.senha_hash, true)`,
        [master.nome, master.email, master.senhaHash],
      );
      return tx.um(
        `SELECT u.id, u.tenant_id, u.nome, p.codigo AS perfil
           FROM usuario u JOIN perfil_acesso p ON p.id = u.perfil_id WHERE u.email = $1`,
        [master.email],
      );
    });
  }

  /** Dados do usuário + menu: só os módulos liberados para a empresa E permitidos para ele. */
  @Get('me')
  async me(@Usuario() u: UsuarioLogado) {
    return this.db.tx({ tenantId: u.tenantId, usuarioId: u.id }, async (tx) => {
      const empresa = await tx.um('SELECT nome, slug FROM tenant WHERE id = $1', [u.tenantId]);
      const menu = await tx.q(
        `SELECT modulo, nome, acoes FROM vw_menu_usuario WHERE usuario_id = $1 ORDER BY ordem`,
        [u.id],
      );
      return { usuario: u, empresa, menu };
    });
  }
}
