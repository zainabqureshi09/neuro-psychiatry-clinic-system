/**
 * Playwright global teardown: remove every synthetic fixture and every row the
 * specs created. Never touches MongoDB or real records.
 */
export default async function globalTeardown(): Promise<void> {
  const { cleanupFixtures } = await import('../scripts/e2eFixtures');
  console.log('\n[e2e] cleaning up synthetic fixtures...');
  await cleanupFixtures();

  // Remove any patient the specs created (only E2E SYNTHETIC% rows).
  const { getPostgresPool, closePostgresPool } = await import('../lib/db/postgres');
  const pool = getPostgresPool();
  if (pool) {
    const ids = (
      await pool.query(`select patient_id from patients where full_name like 'E2E SYNTHETIC%'`)
    ).rows.map((r: any) => r.patient_id);
    if (ids.length > 0) {
      for (const table of ['prescriptions', 'follow_ups', 'consultations', 'clinical_records', 'payments', 'appointments', 'therapy_sessions']) {
        await pool.query(`delete from ${table} where patient_id = any($1::text[])`, [ids]);
      }
      await pool.query(`delete from patients where patient_id = any($1::text[])`, [ids]);
    }
    await pool.query(`delete from audit_logs where user_name like 'E2E %' or description like '%npcs.test%'`);
    const left = await pool.query(
      `select (select count(*)::int from users where email like '%@npcs.test') as users,
              (select count(*)::int from patients where full_name like 'E2E SYNTHETIC%') as patients`
    );
    console.log(`[e2e] residue after cleanup: ${JSON.stringify(left.rows[0])}`);
  }
  await closePostgresPool().catch(() => undefined);
}
