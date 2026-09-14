import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import { join } from 'path';
import { assertTestDatabase, TEST_DATABASE_URL } from './test-db';

/** Recreates the `*_test` database from migrations and seeds reference data once per test run. */
export default async function globalSetup() {
  const dbName = assertTestDatabase(TEST_DATABASE_URL);
  const maintenance = new URL(TEST_DATABASE_URL);
  maintenance.pathname = '/postgres';

  const admin = new PrismaClient({ datasources: { db: { url: maintenance.toString() } } });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.$disconnect();
  }

  const cwd = join(__dirname, '..');
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, SEED_FORCE_PASSWORD_CHANGE: 'false', PRISMA_HIDE_UPDATE_MESSAGE: '1' };
  execSync('npx prisma migrate deploy', { cwd, env, stdio: 'pipe' });
  execSync('npx tsx prisma/seed.ts', { cwd, env, stdio: 'pipe' });
}
