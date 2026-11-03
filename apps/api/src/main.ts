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
  // atrás de proxy/CDN (Vercel, load balancer): IP real para o rate limit da área pública
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
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
