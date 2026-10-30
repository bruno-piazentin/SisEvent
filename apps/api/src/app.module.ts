import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { ErrosFilter } from './comum/erros.filter';
import { AutenticacaoGuard, ModuloGuard } from './auth/guards';
import { AuthController } from './auth/auth.controller';
import { AdminController } from './admin/admin.controller';
import { EmpresasController } from './admin/empresas.controller';
import { CadastrosController } from './cadastros/cadastros.controller';
import { ProfissionaisController } from './profissionais/profissionais.controller';
import { EventosController } from './eventos/eventos.controller';
import { EscalaController } from './escala/escala.controller';
import { CampoController } from './campo/campo.controller';
import { FinanceiroController } from './financeiro/financeiro.controller';
import { BiAgendador, BiController } from './bi/bi.controller';
import { PublicoController } from './publico/publico.controller';

/**
 * Monólito modular: um controller por módulo do escopo (M1..M9 + BI).
 * A liberação por módulo é feita pelo ModuloGuard + @Requer() em cada rota,
 * consultando tem_permissao() no banco.
 */
@Module({
  imports: [DbModule],
  controllers: [
    AuthController,
    AdminController,
    EmpresasController,       // cadastro de empresas (somente master)
    CadastrosController,      // praças, funções, clientes (M3)
    ProfissionaisController,  // M1
    EventosController,        // M4
    EscalaController,         // M5
    CampoController,          // M6
    FinanceiroController,     // M7
    BiController,             // BI
    PublicoController,        // área do profissional por link
  ],
  providers: [
    BiAgendador,
    { provide: APP_GUARD, useClass: AutenticacaoGuard },
    { provide: APP_GUARD, useClass: ModuloGuard },
    { provide: APP_FILTER, useClass: ErrosFilter },
  ],
})
export class AppModule {}
