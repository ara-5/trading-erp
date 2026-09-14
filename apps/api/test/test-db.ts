export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://erp:erp@localhost:5432/erp_test?schema=public';

/** Refuse to run destructive setup against anything that isn't clearly a throwaway test database. */
export function assertTestDatabase(url: string) {
  const name = new URL(url).pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to use database "${name}" for tests: its name must end with "_test".`);
  }
  return name;
}
