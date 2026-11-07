import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { config } from './config';

async function iniciar() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'] });
  // fotos do local chegam em base64 (já reduzidas no navegador); o padrão de 100 kB não comporta
  app.useBodyParser('json', { limit: '8mb' });
  app.setGlobalPrefix('api');
  app.enableCors({ origin: config.corsOrigens, credentials: true });
  // IP real para o limite de tentativas. Só confia em X-Forwarded-For quando há um proxy conhecido
  // na frente (Vercel, Render, ou TRUST_PROXY definido): exposta direto (docker-compose), o cliente
  // escolheria o próprio IP mudando o cabeçalho a cada tentativa.
  app.getHttpAdapter().getInstance().set('trust proxy', config.trustProxy);
  // cabeçalhos de segurança: a API só devolve JSON, nunca é aberta dentro de outro site nem guardada em cache
  app.use((_req: unknown, res: any, next: () => void) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableShutdownHooks();
  await app.listen(config.porta);
  new Logger('SisEvent').log(`API ouvindo em http://localhost:${config.porta}/api`);
}

iniciar();
