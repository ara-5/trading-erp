import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

export const API_PREFIX = 'api';
// Bumped from Express's 100kb default so scanned PDF/image uploads (AI bill extraction) fit as base64 JSON.
const BODY_LIMIT = '16mb';

/**
 * Shared HTTP setup used by both the server entrypoint and the e2e tests. Callers must create the Nest
 * app with `{ bodyParser: false }` so this can install the parsers itself at the larger limit.
 */
export function configureApp(app: NestExpressApplication) {
  app.setGlobalPrefix(API_PREFIX);
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));
  // Needed for correct client IPs (rate limiting) behind the Next.js proxy or a load balancer.
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');
  // The API only serves JSON (plus Swagger UI, which needs inline scripts), so CSP is left to the web app.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true });
  app.useGlobalFilters(new PrismaExceptionFilter());
  return app;
}
