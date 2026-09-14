import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './bootstrap';
import { setupSwagger } from './common/swagger';

async function bootstrap() {
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false }));
  app.enableShutdownHooks();
  if (process.env.SWAGGER !== 'false') setupSwagger(app, API_PREFIX);

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  Logger.log(`ERP API listening on http://localhost:${port}/${API_PREFIX} (docs at /${API_PREFIX}/docs)`, 'Bootstrap');
  if (process.env.DEMO_MODE === 'true') Logger.warn('DEMO_MODE is on: all write requests are rejected', 'Bootstrap');
}

void bootstrap();
