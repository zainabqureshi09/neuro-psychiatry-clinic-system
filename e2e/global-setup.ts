/**
 * Playwright global setup: guarantee the synthetic fixtures exist.
 * Idempotent - safe to run when they already exist.
 */
export default async function globalSetup(): Promise<void> {
  const { seedFixtures } = await import('../scripts/e2eFixtures');
  console.log('\n[e2e] seeding synthetic fixtures...');
  await seedFixtures();
  // Explicit file path: Playwright's loader does not resolve `../lib/db` to index.ts.
  const { closePostgresPool } = await import('../lib/db/postgres');
  await closePostgresPool().catch(() => undefined);
}
