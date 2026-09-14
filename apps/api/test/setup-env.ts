import { assertTestDatabase, TEST_DATABASE_URL } from './test-db';

assertTestDatabase(TEST_DATABASE_URL);
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET ??= 'e2e-test-secret-not-for-production-use-0123456789';
process.env.RATE_LIMIT = '100000';
process.env.LOGIN_RATE_LIMIT = '100000';
process.env.DEMO_MODE = 'false';
process.env.COOKIE_SECURE = 'false';
process.env.SWAGGER = 'false';
