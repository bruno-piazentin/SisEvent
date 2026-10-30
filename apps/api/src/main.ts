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
  app.enableShutdownHooks();
  await app.listen(config.porta);
  new Logger('SisEvent').log(`API ouvindo em http://localhost:${config.porta}/api`);
}

iniciar();
