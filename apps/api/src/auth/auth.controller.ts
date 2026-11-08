import { Body, Controller, Get, HttpCode, HttpException, Ip, Post, UnauthorizedException, Inject, Logger, OnModuleInit } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { DbService } from '../db/db.service';
import { Validar } from '../comum/validacao';
import { limitar } from '../comum/limite';
import { randomUUID } from 'node:crypto';
import { MODULOS } from '../admin/admin.controller';
import { criarEmpresa } from '../admin/empresas.controller';
import { Publico, Usuario, UsuarioLogado } from './decorators';

// tamanhos limitados: o e-mail entra na chave do limite de tentativas, guardada em memória
const Login = z.object({
  empresa: z.string().min(2).max(64),  // slug da empresa: "rafadutra"
  email: z.string().trim().max(254).email(),
  senha: z.string().min(6).max(200),
});

/** Senha errada 5 vezes seguidas: o usuário fica bloqueado por 15 minutos (mesmo acertando) */
function bloqueado(ate: Date) {
  const hora = new Date(ate).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return new HttpException({ codigo: 'usuario_bloqueado',
    mensagem: `Muitas tentativas com senha errada. Por segurança, o acesso foi bloqueado até ${hora}. Se esqueceu a senha, peça à administradora para redefinir.` }, 429);
}

@Controller('auth')
export class AuthController implements OnModuleInit {
  private readonly log = new Logger('Auth');
  constructor(@Inject(DbService) private readonly db: DbService) {}

  /**
   * Versões antigas gravavam o hash do master nas linhas dele em cada empresa; com isso a senha
   * continuava valendo pela rota comum depois de o master ser desligado. Na subida, essas linhas
   * perdem a senha (o master só entra pela rota própria, enquanto estiver configurado).
   */
  async onModuleInit() {
    if (!config.master) return;
    try {
      const r = await this.db.tx({}, (tx) => tx.um<{ n: number }>('SELECT limpar_senha_master($1, $2) AS n',
        [config.master!.email, config.master!.senhaHash]));
      if (r?.n) this.log.log(`Senha do master removida de ${r.n} usuário(s) de empresa`);
    } catch (e: any) {
      this.log.warn(`Limpeza da senha do master não executada: ${e.message}`);
    }
  }

  @Publico()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new Validar(Login)) dto: z.infer<typeof Login>, @Ip() ip: string) {
    // tentativa e erro de senhas: por IP e por IP + e-mail. O bloqueio do usuário (5 erros
    // seguidos = 15 minutos) fica no banco e vale para todos os servidores.
    limitar(`login:${ip}`, 20, 60_000, 'Muitas tentativas de login. Aguarde um minuto e tente de novo.');
    limitar(`login:${ip}:${dto.email.toLowerCase()}`, 8, 15 * 60_000, 'Muitas tentativas com este e-mail. Aguarde 15 minutos.');
    const master = !!config.master && dto.email.toLowerCase() === config.master.email;
    const u = master ? await this.loginMaster(dto) : await this.loginComum(dto);
    // mesma mensagem para usuário inexistente e senha errada (não revela quem tem conta)
    if (!u) throw new UnauthorizedException({ codigo: 'credenciais_invalidas', mensagem: 'E-mail ou senha incorretos.' });

    if (master) {   // os demais já registram o acesso em confirmar_login_ok
      await this.db.tx({ tenantId: u.tenant_id, usuarioId: u.id }, (tx) =>
        tx.q('UPDATE usuario SET ultimo_acesso = now() WHERE id = $1', [u.id]),
      );
    }
    // ims: emissão em milissegundos (o iat é em segundos). Sem ele, sair e entrar de novo no mesmo segundo derrubaria a sessão nova
    const token = jwt.sign({ sub: u.id, tid: u.tenant_id, nome: u.nome, perfil: u.perfil, ims: Date.now(), ...(master ? { master } : {}) },
      config.jwtSegredo, { expiresIn: config.jwtValidade as jwt.SignOptions['expiresIn'] });
    return { token, usuario: { id: u.id, nome: u.nome, perfil: u.perfil, master } };
  }

  private async loginComum(dto: z.infer<typeof Login>) {
    const u = await this.db.tx({}, (tx) =>
      tx.um('SELECT * FROM buscar_usuario_login($1, $2)', [dto.email, dto.empresa]),
    );
    if (!u) return undefined;
    if (u.bloqueado_ate) throw bloqueado(u.bloqueado_ate);
    // a tentativa é reservada (conta como erro) ANTES de conferir a senha: tentativas simultâneas
    // não passam do limite de 5, porque a 5ª reserva já bloqueia as seguintes
    const r = await this.db.tx({ tenantId: u.tenant_id }, (tx) =>
      tx.um<{ ate: Date | null }>('SELECT reservar_tentativa_login($1) AS ate', [u.id]));
    if (r?.ate) throw bloqueado(r.ate);
    const ok = !!(u.ativo && u.senha_hash && (await bcrypt.compare(dto.senha, u.senha_hash)));
    if (!ok) return undefined;
    await this.db.tx({ tenantId: u.tenant_id }, (tx) => tx.q('SELECT confirmar_login_ok($1)', [u.id]));
    return u;
  }

  /**
   * Master de manutenção: a senha é conferida com o hash do ambiente, não com o banco.
   * Na empresa escolhida ele vira (ou continua) um usuário admin comum, então permissões,
   * RLS e auditoria funcionam como para qualquer outro usuário.
   */
  private async loginMaster(dto: z.infer<typeof Login>) {
    const master = config.master!;
    // mesmo bloqueio dos demais (5 erros seguidos = 15 minutos), guardado no banco para valer em todos os servidores
    // reservada antes do bcrypt, como nos demais usuários
    const trava = await this.db.tx({}, (tx) => tx.um<{ ate: Date | null }>(`SELECT reservar_tentativa_chave('master') AS ate`));
    if (trava?.ate) throw bloqueado(trava.ate);
    const ok = await bcrypt.compare(dto.senha, master.senhaHash);
    if (!ok) return undefined;
    await this.db.tx({}, (tx) => tx.q(`SELECT confirmar_chave_ok('master')`));
    const t = await this.db.tx({}, (tx) =>
      tx.um<{ id: string | null; empresas: number }>(
        'SELECT tenant_por_slug($1) AS id, (SELECT count(*)::int FROM listar_empresas()) AS empresas', [dto.empresa]));
    let tenantId = t?.id;
    // banco recém-criado (produção sem seed): o primeiro login do master cria a empresa digitada;
    // as demais são cadastradas pela tela Empresas
    const primeiraEmpresa = !tenantId && t?.empresas === 0 && /^[a-z0-9][a-z0-9-]{1,39}$/.test(dto.empresa);
    if (primeiraEmpresa) tenantId = randomUUID();
    if (!tenantId) return undefined;
    return this.db.tx({ tenantId }, async (tx) => {
      if (primeiraEmpresa) await criarEmpresa(tx, tenantId!, dto.empresa, dto.empresa, MODULOS);
      // a linha do master na empresa NÃO guarda senha: ele só entra por esta rota, enquanto
      // MASTER_EMAIL/MASTER_SENHA_HASH estiverem no ambiente (desligar o master corta o acesso)
      await tx.q(
        `INSERT INTO usuario (perfil_id, nome, email, senha_hash)
         SELECT p.id, $1, $2, NULL FROM perfil_acesso p WHERE p.codigo = 'admin'
         ON CONFLICT (tenant_id, email) DO UPDATE
            SET perfil_id = EXCLUDED.perfil_id, nome = EXCLUDED.nome, senha_hash = NULL, ativo = true
          WHERE (usuario.perfil_id, usuario.nome, usuario.senha_hash, usuario.ativo)
                IS DISTINCT FROM (EXCLUDED.perfil_id, EXCLUDED.nome, NULL, true)`,
        [master.nome, master.email],
      );
      return tx.um(
        `SELECT u.id, u.tenant_id, u.nome, p.codigo AS perfil
           FROM usuario u JOIN perfil_acesso p ON p.id = u.perfil_id WHERE u.email = $1`,
        [master.email],
      );
    });
  }

  /**
   * Sair: as sessões deste usuário emitidas até agora deixam de valer no servidor (o guard compara
   * com sessoes_desde). Um token copiado antes da saída não serve mais. Desconecta também os outros
   * aparelhos dele: é o preço de não guardar lista de sessões.
   */
  @Post('sair')
  @HttpCode(204)
  async sair(@Usuario() u: UsuarioLogado) {
    await this.db.tx({ tenantId: u.tenantId, usuarioId: u.id }, (tx) =>
      tx.q('UPDATE usuario SET sessoes_desde = to_timestamp($2::float8 / 1000) WHERE id = $1', [u.id, Date.now()]));
  }

  /** Dados do usuário + menu: só os módulos liberados para a empresa E permitidos para ele. */
  @Get('me')
  async me(@Usuario() u: UsuarioLogado) {
    return this.db.tx({ tenantId: u.tenantId, usuarioId: u.id }, async (tx) => {
      const empresa = await tx.um('SELECT id, nome, slug, logo, prazos_eventos FROM tenant WHERE id = $1', [u.tenantId]);
      const menu = await tx.q(
        `SELECT modulo, nome, acoes::text[] AS acoes FROM vw_menu_usuario WHERE usuario_id = $1 ORDER BY ordem`,
        [u.id],
      );
      return { usuario: u, empresa, menu };
    });
  }
}
