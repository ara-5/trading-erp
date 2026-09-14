/* eslint-disable @typescript-eslint/no-explicit-any */
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { Test as PendingRequest } from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

export const ADMIN = { email: 'admin@erp.local', password: 'Admin@12345' };
export const today = () => new Date().toISOString().slice(0, 10);
export const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export async function createApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'], bodyParser: false }));
  await app.init();
  return app;
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Client {
  token: string;
  raw(method: Method, path: string, body?: object, query?: object): PendingRequest;
  get<T = any>(path: string, query?: object): Promise<T>;
  post<T = any>(path: string, body?: object): Promise<T>;
  put<T = any>(path: string, body: object): Promise<T>;
  patch<T = any>(path: string, body: object): Promise<T>;
  /** Asserts the request fails with `status` and returns the error message. */
  fails(method: Method, path: string, body: object | undefined, status: number): Promise<string>;
}

export function client(app: NestExpressApplication, token: string): Client {
  const server = app.getHttpServer();
  const raw = (method: Method, path: string, body?: object, query?: object) => {
    let req = request(server)[method](`/api${path}`).set('Authorization', `Bearer ${token}`);
    if (query) req = req.query(query);
    if (body !== undefined) req = req.send(body);
    return req;
  };
  const ok = async (method: Method, path: string, body?: object, query?: object) => {
    const res = await raw(method, path, body, query);
    if (res.status >= 400) throw new Error(`${method.toUpperCase()} ${path} → ${res.status}: ${JSON.stringify(res.body)}`);
    return res.body;
  };
  return {
    token,
    raw,
    get: (path, query) => ok('get', path, undefined, query),
    post: (path, body = {}) => ok('post', path, body),
    put: (path, body) => ok('put', path, body),
    patch: (path, body) => ok('patch', path, body),
    fails: async (method, path, body, status) => {
      const res = await raw(method, path, body);
      if (res.status !== status) throw new Error(`Expected ${status} from ${method.toUpperCase()} ${path}, got ${res.status}: ${JSON.stringify(res.body)}`);
      return String(res.body?.message ?? '');
    },
  };
}

export async function loginAs(app: NestExpressApplication, email: string, password: string) {
  const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return client(app, res.body.accessToken);
}

/** Collects a binary response body (supertest only buffers text/JSON by default). */
export const binary = (res: any, done: (err: Error | null, body: any) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

export async function accountsByCode(api: Client) {
  const accounts: { id: string; code: string }[] = await api.get('/accounting/accounts');
  return (code: string) => {
    const found = accounts.find((a) => a.code === code);
    if (!found) throw new Error(`Account ${code} not found`);
    return found.id;
  };
}
