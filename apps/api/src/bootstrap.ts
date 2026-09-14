import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

export const API_PREFIX = 'api';

/** Shared HTTP setup used by both the server entrypoint and the e2e tests. */
export function configureApp(app: NestExpressApplication) {
  app.setGlobalPrefix(API_PREFIX);
  // Needed for correct client IPs (rate limiting) behind the Next.js proxy or a load balancer.
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  // The API only serves JSON (plus Swagger UI, which needs inline scripts), so CSP is left to the web app.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true });
  app.useGlobalFilters(new PrismaExceptionFilter());
  return app;
}
