import '@testing-library/jest-dom';

/**
 * Placeholder configuration for the test run.
 *
 * Several modules read environment at import time and throw when a variable is
 * missing — `src/lib/db/client.ts` is the loudest. That made some suites depend
 * on the developer's own `.env.local`, so they passed locally and failed in CI
 * with "TURSO_DATABASE_URL is not defined", which reads like a broken test
 * rather than a missing secret.
 *
 * These values are deliberately fake. Anything that would really talk to a
 * database, an LLM or an SMTP server must be mocked in the test; this only
 * stops module initialisation from exploding. A test that somehow reaches the
 * network with these will fail loudly, which is the intent.
 */
const TEST_ENV: Record<string, string> = {
  TURSO_DATABASE_URL: 'libsql://test.invalid',
  TURSO_AUTH_TOKEN: 'test-token',
  OPENROUTER_API_KEY: 'test-openrouter-key',
  SESSION_SECRET: 'test-session-secret',
  CRON_SECRET: 'test-cron-secret',
  // NEXT_PUBLIC_APP_URL is deliberately NOT set. Several routes fall back to
  // the request's own origin when it is absent, and that fallback is behaviour
  // worth testing — setting a default here silently disables it.
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] ??= value;
}
