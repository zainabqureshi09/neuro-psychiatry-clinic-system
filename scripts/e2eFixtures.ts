/**
 * E2E fixture harness - SYNTHETIC data only.
 *
 * Creates dedicated test staff accounts and one synthetic patient for browser
 * tests, and removes exactly what it created.
 *
 * Guarantees:
 *  - Emails use the reserved `.test` TLD (@npcs.test) - never a real domain.
 *  - Patient records are named "E2E SYNTHETIC ..." with an obviously fake phone.
 *  - Cleanup deletes ONLY rows matching those markers, plus their dependent
 *    clinical rows and audit entries.
 *  - Never touches MongoDB.
 *  - No production admin account is created (no bootstrap path is used).
 *
 * Usage:
 *   npx tsx scripts/e2eFixtures.ts            # create / refresh fixtures
 *   npx tsx scripts/e2eFixtures.ts --cleanup  # remove fixtures
 *   npx tsx scripts/e2eFixtures.ts --status   # report what exists
 */
import fs from 'node:fs';
import path from 'node:path';

for (const envFile of ['.env.local', '.env']) {
  const p = path.resolve(__dirname, '..', envFile);
  if (fs.existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* ignore */
    }
  }
}

const EMAIL_DOMAIN = '@npcs.test';
const PATIENT_MARKER = 'E2E SYNTHETIC';
const PATIENT_PHONE = '03000000001';

export const E2E_USERS = [
  { email: `e2e.admin${EMAIL_DOMAIN}`, password: 'E2eAdmin!2026', role: 'ADMIN' as const, name: 'E2E Admin' },
  { email: `e2e.doctor${EMAIL_DOMAIN}`, password: 'E2eDoctor!2026', role: 'DOCTOR' as const, name: 'E2E Doctor' },
  { email: `e2e.therapist${EMAIL_DOMAIN}`, password: 'E2eTherapist!2026', role: 'THERAPIST' as const, name: 'E2E Therapist' },
  { email: `e2e.reception${EMAIL_DOMAIN}`, password: 'E2eReception!2026', role: 'RECEPTION' as const, name: 'E2E Reception' },
];

export const E2E_PATIENT = {
  fullName: `${PATIENT_MARKER} PATIENT`,
  dateOfBirth: '1990-01-01',
  age: 35,
  gender: 'Other',
  phone: PATIENT_PHONE,
  email: `synthetic${EMAIL_DOMAIN}`,
  address: 'Synthetic Test Address',
};

export async function seedFixtures(): Promise<void> {
  const { createUser, findUserByEmail } = await import('../lib/db/repositories/userRepository');
  const { createPatient, findPatientConflict } = await import('../lib/db/repositories/patientRepository');

  for (const u of E2E_USERS) {
    const existing = await findUserByEmail(u.email);
    if (existing) {
      console.log(`  user exists : ${u.role.padEnd(10)} ${u.email}`);
      continue;
    }
    const created = await createUser({
      name: u.name,
      email: u.email,
      password: u.password,
      role: u.role,
      title: 'E2E Test Account',
      department: 'Quality Assurance',
    });
    console.log(`  user created: ${u.role.padEnd(10)} ${u.email} (${created.userId})`);
  }

  const conflict = await findPatientConflict(PATIENT_PHONE, undefined);
  if (conflict) {
    console.log(`  patient exists : ${(conflict as any).patientId}`);
  } else {
    const patient = await createPatient({ ...E2E_PATIENT, createdBy: 'E2E-FIXTURE' });
    console.log(`  patient created: ${patient.fullName} (${patient.patientId})`);
  }
}

export async function cleanupFixtures(): Promise<{ users: number; patients: number }> {
  const { getPostgresPool } = await import('../lib/db/postgres');
  const pool = getPostgresPool();
  if (!pool) throw new Error('No pg pool - DATABASE_URL missing.');

  const emails = E2E_USERS.map((u) => u.email);

  const delAudit = await pool.query(
    `delete from audit_logs
      where user_id in (select user_id from users where email = any($1::text[]))
         or user_name like 'E2E %'
         or description like '%npcs.test%'`,
    [emails]
  );

  const patientIds = await pool.query(`select patient_id from patients where full_name like $1 or phone = $2`, [
    `${PATIENT_MARKER}%`,
    PATIENT_PHONE,
  ]);
  const ids = patientIds.rows.map((r: any) => r.patient_id);

  let deletedClinical = 0;
  if (ids.length > 0) {
    for (const table of ['prescriptions', 'follow_ups', 'consultations', 'clinical_records', 'payments', 'appointments', 'therapy_sessions']) {
      const r = await pool.query(`delete from ${table} where patient_id = any($1::text[])`, [ids]);
      deletedClinical += r.rowCount || 0;
    }
  }
  const delPatients = await pool.query(`delete from patients where patient_id = any($1::text[])`, [ids]);
  const delUsers = await pool.query(`delete from users where email = any($1::text[])`, [emails]);

  console.log(
    `  removed: ${delUsers.rowCount} users, ${delPatients.rowCount} patients, ` +
      `${deletedClinical} clinical rows, ${delAudit.rowCount} audit rows`
  );
  return { users: delUsers.rowCount || 0, patients: delPatients.rowCount || 0 };
}

export async function statusFixtures(): Promise<void> {
  const { getPostgresPool } = await import('../lib/db/postgres');
  const pool = getPostgresPool()!;
  const emails = E2E_USERS.map((u) => u.email);
  const u = await pool.query('select count(*)::int n from users where email = any($1::text[])', [emails]);
  const p = await pool.query('select count(*)::int n from patients where full_name like $1', [`${PATIENT_MARKER}%`]);
  console.log(`  e2e users: ${u.rows[0].n} / ${E2E_USERS.length}`);
  console.log(`  e2e patients: ${p.rows[0].n}`);
}

if (require.main === module) {
  (async () => {
    const arg = process.argv[2];
    console.log(`E2E fixtures - ${arg || '--seed'}`);
    if (arg === '--cleanup') {
      await cleanupFixtures();
    } else if (arg === '--status') {
      await statusFixtures();
    } else {
      await seedFixtures();
      console.log('');
      await statusFixtures();
    }
    const { closePostgresPool } = await import('../lib/db/postgres');
    await closePostgresPool().catch(() => undefined);
  })().catch((e) => {
    console.error('FATAL:', e?.message || e);
    process.exit(1);
  });
}
