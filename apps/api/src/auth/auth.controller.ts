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
    const u = await this.db.tx({}, (tx) =>
      tx.um('SELECT * FROM buscar_usuario_login($1, $2)', [dto.email, dto.empresa]),
    );
    // mesma mensagem para usuário inexistente e senha errada (não revela quem tem conta)
    const ok = u?.ativo && u.senha_hash && (await bcrypt.compare(dto.senha, u.senha_hash));
    if (!ok) throw new UnauthorizedException({ codigo: 'credenciais_invalidas', mensagem: 'E-mail ou senha incorretos.' });

    await this.db.tx({ tenantId: u.tenant_id, usuarioId: u.id }, (tx) =>
      tx.q('UPDATE usuario SET ultimo_acesso = now() WHERE id = $1', [u.id]),
    );
    const token = jwt.sign({ sub: u.id, tid: u.tenant_id, nome: u.nome, perfil: u.perfil }, config.jwtSegredo, {
      expiresIn: config.jwtValidade as jwt.SignOptions['expiresIn'],
    });
    return { token, usuario: { id: u.id, nome: u.nome, perfil: u.perfil } };
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
