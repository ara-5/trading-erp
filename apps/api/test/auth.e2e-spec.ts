import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { ADMIN, client, createApp, loginAs, uid } from './helpers';

const refreshCookie = (res: request.Response) => {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('erp_rt='));
  if (!cookie) throw new Error('No refresh cookie set');
  return cookie.split(';')[0];
};

describe('Auth & security (e2e)', () => {
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(() => app.close());

  it('rejects bad credentials without revealing which part was wrong', async () => {
    const res = await http().post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Invalid email or password');
    const unknown = await http().post('/api/auth/login').send({ email: 'nobody@erp.local', password: 'whatever' });
    expect(unknown.body.message).toBe('Invalid email or password');
  });

  it('requires a bearer token on protected routes', async () => {
    expect((await http().get('/api/dashboard')).status).toBe(401);
    expect((await http().get('/api/health')).status).toBe(200);
  });

  it('issues an httpOnly refresh cookie and rotates it on refresh', async () => {
    const login = await http().post('/api/auth/login').send(ADMIN).expect(200);
    const raw = ([] as string[]).concat(login.headers['set-cookie']).join(';');
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/Path=\/api\/auth/);
    expect(raw).toMatch(/SameSite=Lax/i);

    const first = refreshCookie(login);
    const refreshed = await http().post('/api/auth/refresh').set('Cookie', first).expect(200);
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    const second = refreshCookie(refreshed);
    expect(second).not.toEqual(first);

    // The rotated token is dead, but a quick retry (e.g. a second tab) doesn't nuke the session.
    await http().post('/api/auth/refresh').set('Cookie', first).expect(401);
    await http().post('/api/auth/refresh').set('Cookie', second).expect(200);
  });

  it('revokes every session when an old refresh token is replayed later', async () => {
    const prisma = app.get(PrismaService);
    const login = await http().post('/api/auth/login').send(ADMIN).expect(200);
    const stale = refreshCookie(login);
    const current = refreshCookie(await http().post('/api/auth/refresh').set('Cookie', stale).expect(200));

    // Simulate the stale token being replayed well after it was rotated.
    await prisma.refreshToken.updateMany({ where: { replacedById: { not: null }, revokedAt: { gt: new Date(Date.now() - 5_000) } }, data: { revokedAt: new Date(Date.now() - 120_000) } });
    await http().post('/api/auth/refresh').set('Cookie', stale).expect(401);
    await http().post('/api/auth/refresh').set('Cookie', current).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const login = await http().post('/api/auth/login').send(ADMIN).expect(200);
    const cookie = refreshCookie(login);
    await http().post('/api/auth/logout').set('Cookie', cookie).expect(204);
    await http().post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('forces admin-created users to change their password and enforces roles', async () => {
    const admin = await loginAs(app, ADMIN.email, ADMIN.password);
    const email = `sales.${uid().toLowerCase()}@erp.local`;
    await admin.post('/admin/users', { email, name: 'Sales Tester', role: 'SALES', password: 'TempPass1234' });

    const temp = await loginAs(app, email, 'TempPass1234');
    expect((await temp.get('/auth/me')).mustChangePassword).toBe(true);
    expect(await temp.fails('get', '/sales/customers', undefined, 403)).toMatch(/change your password/);
    expect(await temp.fails('post', '/auth/change-password', { currentPassword: 'TempPass1234', newPassword: 'short' }, 400)).toMatch(/Validation/);

    const changed = await temp.post('/auth/change-password', { currentPassword: 'TempPass1234', newPassword: 'MyOwnPassword-42' });
    const user = client(app, changed.accessToken);
    expect(changed.user.mustChangePassword).toBe(false);
    await user.get('/sales/customers');
    expect(await user.fails('get', '/hr/employees', undefined, 403)).toBe('Insufficient role');
  });

  it('rejects writes but allows reads and login in demo mode', async () => {
    const admin = await loginAs(app, ADMIN.email, ADMIN.password);
    process.env.DEMO_MODE = 'true';
    try {
      expect(await admin.fails('post', '/sales/customers', { name: 'Demo write' }, 403)).toMatch(/read-only demo/);
      await admin.get('/sales/customers');
      await http().post('/api/auth/login').send(ADMIN).expect(200);
    } finally {
      process.env.DEMO_MODE = 'false';
    }
  });

  it('rate-limits repeated login attempts', async () => {
    process.env.LOGIN_RATE_LIMIT = '3';
    const fresh = await createApp();
    try {
      const attempt = () => request(fresh.getHttpServer()).post('/api/auth/login').send({ email: ADMIN.email, password: 'nope' });
      for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
      expect((await attempt()).status).toBe(429);
    } finally {
      process.env.LOGIN_RATE_LIMIT = '100000';
      await fresh.close();
    }
  });
});
