import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config';

/** Contexto de quem está fazendo a requisição — vira SET LOCAL na transação (RLS + auditoria). */
export interface ContextoDb {
  tenantId?: string;
  usuarioId?: string;
  motivo?: string;
}

export interface Tx {
  q<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T[]>;
  um<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly log = new Logger('Db');
  readonly pool = new Pool({
    connectionString: config.databaseUrl,
    // na Vercel cada instância da função abre o próprio pool: poucas conexões por instância
    max: Number(process.env.DB_POOL_MAX ?? (process.env.VERCEL ? 2 : 10)),
    idleTimeoutMillis: 30_000,
    ssl: config.dbSsl,
  });

  /**
   * Executa `fn` numa transação com o contexto da requisição aplicado.
   * Todas as consultas da API passam por aqui — é o que faz o RLS e a auditoria funcionarem.
   */
  async tx<T>(ctx: ContextoDb, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.tenant_id', $1, true),
                set_config('app.usuario_id', $2, true),
                set_config('app.motivo', $3, true)`,
        [ctx.tenantId ?? '', ctx.usuarioId ?? '', ctx.motivo ?? ''],
      );
      const tx: Tx = {
        q: async (sql, params) => (await client.query(sql, params as any[])).rows,
        um: async (sql, params) => (await client.query(sql, params as any[])).rows[0],
      };
      const resultado = await fn(tx);
      await client.query('COMMIT');
      return resultado;
    } catch (erro) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
    this.log.log('Pool encerrado');
  }
}
