import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { ModulesContainer } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { IS_PUBLIC } from './auth';
import { ZodPipe } from './zod';

type Operation = {
  tags?: string[];
  summary?: string;
  security?: Record<string, string[]>[];
  requestBody?: unknown;
  parameters?: { name: string; in: string; required?: boolean; schema?: unknown }[];
};

const toJsonSchema = (pipe: ZodPipe<never>) =>
  zodToJsonSchema(pipe.schema, { target: 'openApi3', $refStrategy: 'none' }) as { properties?: Record<string, unknown>; required?: string[] };

const joinPath = (...parts: string[]) =>
  '/' +
  parts
    .flatMap((p) => p.split('/'))
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? `{${seg.slice(1)}}` : seg))
    .join('/');

const humanize = (s: string) => s.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Validation lives in Zod schemas passed to `ZodPipe`, not in DTO classes, so Swagger can't see it.
 * This walks every route, finds the ZodPipes on @Body/@Query params and writes their JSON Schema
 * into the generated document — the docs can never drift from the actual validation.
 */
function applyZodSchemas(app: INestApplication, document: OpenAPIObject, prefix: string) {
  const modules = app.get(ModulesContainer);
  for (const mod of modules.values()) {
    for (const wrapper of mod.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | undefined;
      if (!controller?.prototype) continue;
      const basePath: string = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
      const tag = humanize(basePath.split('/').filter(Boolean).join(' / ') || 'General');
      const classPublic = Reflect.getMetadata(IS_PUBLIC, controller) === true;

      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        const handler = controller.prototype[name];
        if (typeof handler !== 'function' || name === 'constructor') continue;
        const method: RequestMethod | undefined = Reflect.getMetadata(METHOD_METADATA, handler);
        if (method === undefined) continue;

        const path = joinPath(prefix, basePath, Reflect.getMetadata(PATH_METADATA, handler) ?? '');
        const op = (document.paths[path] as Record<string, Operation> | undefined)?.[RequestMethod[method].toLowerCase()];
        if (!op) continue;

        op.tags = [tag];
        op.summary ??= humanize(name.replace(/([a-z])([A-Z])/g, '$1 $2'));
        if (classPublic || Reflect.getMetadata(IS_PUBLIC, handler) === true) op.security = [];

        const args: Record<string, { index: number; pipes?: unknown[] }> = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {};
        for (const [key, arg] of Object.entries(args)) {
          const type = Number(key.split(':')[0]);
          const pipe = arg.pipes?.find((p): p is ZodPipe<never> => p instanceof ZodPipe);
          if (!pipe) continue;
          const schema = toJsonSchema(pipe);
          if (type === RouteParamtypes.BODY) {
            op.requestBody = { required: true, content: { 'application/json': { schema } } };
          } else if (type === RouteParamtypes.QUERY) {
            const required = new Set(schema.required ?? []);
            const pathParams = (op.parameters ?? []).filter((p) => p.in === 'path');
            op.parameters = [
              ...pathParams,
              ...Object.entries(schema.properties ?? {}).map(([prop, propSchema]) => ({ name: prop, in: 'query', required: required.has(prop), schema: propSchema })),
            ];
          }
        }
      }
    }
  }
}

export function createOpenApiDocument(app: INestApplication, prefix = 'api') {
  const config = new DocumentBuilder()
    .setTitle('Trading ERP API')
    .setDescription(
      'Accounting, inventory, purchasing, sales/CRM and HR/payroll on a double-entry ledger.\n\n' +
        'Authenticate with `POST /api/auth/login`, then click **Authorize** and paste the `accessToken`. ' +
        'Request schemas are generated from the same Zod schemas that validate requests.',
    )
    .setVersion(process.env.npm_package_version ?? '0.2.0')
    .addBearerAuth()
    .addSecurityRequirements('bearer')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  applyZodSchemas(app, document, prefix);
  return document;
}

export function setupSwagger(app: INestApplication, prefix = 'api') {
  const document = createOpenApiDocument(app, prefix);
  SwaggerModule.setup(`${prefix}/docs`, app, document, { jsonDocumentUrl: `${prefix}/docs-json`, swaggerOptions: { persistAuthorization: true } });
  return document;
}
