/**
 * Phase 2 - LIVE integration tests against the real Supabase project.
 *
 * SAFETY:
 *  - MongoDB is never imported, opened, read or written.
 *  - No data is migrated.
 *  - Every row created here is tagged with a RUN_ID and deleted at the end.
 *  - Writes a report to scratch/phase2-report.txt so terminal capture is optional.
 *
 * Run: npx tsx scripts/testPhase2Live.ts
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

const RUN_ID = `P2T${Date.now().toString(36).toUpperCase()}`;
const REPORT: string[] = [];
const state = { pass: 0, fail: 0, skip: 0 };

function log(msg = ''): void {
  REPORT.push(msg);
}

function check(name: string, ok: boolean, detail = ''): boolean {
  const tag = ok ? '[PASS]' : '[FAIL]';
  if (ok) state.pass += 1;
  else state.fail += 1;
  log(`${tag} ${name}${detail ? ' :: ' + detail : ''}`);
  return ok;
}

function skip(name: string, detail: string): void {
  state.skip += 1;
  log(`[SKIP] ${name} :: ${detail}`);
}

function flush(): void {
  const out = path.resolve(__dirname, '..', 'scratch', 'phase2-report.txt');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, REPORT.join('\n') + '\n', 'utf8');
  console.log(REPORT.join('\n'));
}

async function main(): Promise<void> {
  log('====================================================================');
  log(` NPCS - Phase 2 LIVE integration report   (run id ${RUN_ID})`);
  log(` generated: ${new Date().toISOString()}`);
  log('====================================================================');

  // Dynamic imports so the env file is loaded first.
  const db = await import('../lib/db');
  const { getDatabaseConfig, ensureDatabaseReady, getSupabaseClient, getPostgresPool, checkPostgresConnection, withTransaction } = db;
  const { createUser, findUserByEmail, findUserById } = await import('../lib/db/repositories/userRepository');
  const { createPatient, listPatients, findPatientConflict, softDeletePatient } = await import('../lib/db/repositories/patientRepository');
  const { createConsultationCascade } = await import('../lib/db/repositories/consultationCascade');
  const { recordPayment, updatePayment } = await import('../lib/db/repositories/billingRepository');
  const { recordAuditEvent, listAuditLogs } = await import('../lib/db/repositories/auditRepository');
  const { getClinicSettings } = await import('../lib/db/repositories/settingsRepository');
  const authLib = await import('../lib/auth');
  const { generateToken, verifyToken } = await import('../backend/utils/authUtils');

  const cfg = getDatabaseConfig();

  // ---------------------------------------------------------------- A. env
  log('\n--- A. Credentials ---');
  const url = cfg.supabaseUrl || '';
  check('SUPABASE_URL points at the live project', url.includes('gqxzbrfjqzgktkqbhtqi'), url.replace(/^https:\/\//, ''));
  check('Supabase configured (format check)', cfg.isSupabaseConfigured);
  check('Secret key loaded', Boolean(cfg.supabaseSecretKey));

  try {
    const client = getSupabaseClient();
    const { error } = await client!.from('users').select('user_id').limit(1);
    check('Secret key accepted by PostgREST (service_role)', !error, error ? error.message : 'HTTP 200');
  } catch (e: any) {
    check('Secret key accepted by PostgREST (service_role)', false, e?.message);
  }

  // ----------------------------------------------------------- B. provider
  log('\n--- B. Provider selection ---');
  check('Provider is postgres (not mongodb)', cfg.provider === 'postgres', cfg.provider);
  try {
    const ready = await ensureDatabaseReady();
    check('ensureDatabaseReady() resolves postgres', ready === 'postgres', ready);
  } catch (e: any) {
    check('ensureDatabaseReady() resolves postgres', false, e?.message);
  }

  // ------------------------------------------------------------- C. pooler
  log('\n--- C. DATABASE_URL / session pooler ---');
  check('DATABASE_URL configured', cfg.isPostgresConfigured);
  const pool = getPostgresPool();
  check('pg pool created', Boolean(pool));
  const poolUp = pool ? await checkPostgresConnection() : false;
  check('SELECT 1 through session pooler', poolUp);
  if (pool) {
    const v = await pool.query('select version() as ver');
    check('server reachable', true, String(v.rows[0].ver).split(',')[0]);
  }
  // -------------------------------------------------------- D. transactions
  log('\n--- D. Real transactions (BEGIN / COMMIT / ROLLBACK) ---');
  const txLog1 = `${RUN_ID}-TX1`;
  const txLog2 = `${RUN_ID}-TX2`;
  const insertAudit = (c: any, id: string, note: string) =>
    c.query(
      `insert into audit_logs (log_id, timestamp, user_id, user_name, user_role, action, module, description)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, new Date().toISOString(), 'PHASE2-TEST', 'Phase 2 TX', 'SYSTEM', 'TEST', 'PHASE2', note]
    );

  try {
    await withTransaction(async (c: any) => {
      await insertAudit(c, txLog1, 'commit path');
    });
    const after = pool ? await pool.query('select 1 from audit_logs where log_id = $1', [txLog1]) : { rows: [] };
    check('transaction COMMIT persists the row', after.rows.length === 1);
  } catch (e: any) {
    check('transaction COMMIT persists the row', false, e?.message);
  }

  let rolledBack = false;
  try {
    await withTransaction(async (c: any) => {
      await insertAudit(c, txLog2, 'rollback path');
      throw new Error('intentional rollback');
    });
  } catch (e: any) {
    rolledBack = /intentional rollback/.test(e?.message || '');
  }
  const gone = pool ? await pool.query('select 1 from audit_logs where log_id = $1', [txLog2]) : { rows: [{}] };
  check('transaction ROLLBACK discards the row', rolledBack && gone.rows.length === 0);

  try {
    const before = await getClinicSettings();
    try {
      await withTransaction(async (c: any) => {
        await c.query(`update clinic_settings set clinic_name = 'ROLLBACK-TEST' where id = 1`);
        throw new Error('intentional rollback');
      });
    } catch {
      /* expected */
    }
    const after = await getClinicSettings();
    check('rollback restores a real UPDATE', after.clinicName === before.clinicName, after.clinicName);
  } catch (e: any) {
    check('rollback restores a real UPDATE', false, e?.message);
  }

  // -------------------------------------------------------------- E. auth
  log('\n--- E. Live authentication (bcrypt + JWT + RBAC) ---');
  const testEmail = `${RUN_ID.toLowerCase()}@p2test.local`;
  const testPassword = 'P2Test!Passw0rd';
  let testUser: any = null;
  try {
    testUser = await createUser({
      name: 'Phase2 Test Admin',
      email: testEmail,
      password: testPassword,
      role: 'ADMIN',
      title: 'QA',
      department: 'QA',
    });
    check('createUser stores a bcrypt hash', String(testUser?.passwordHash).startsWith('$2'), testUser?.userId);
  } catch (e: any) {
    check('createUser stores a bcrypt hash', false, e?.message);
  }

  if (testUser) {
    const found = await findUserByEmail(testEmail);
    check('findUserByEmail returns the row', found?.userId === testUser.userId);

    check('verifyPassword accepts the correct password', await authLib.verifyPassword(testPassword, testUser.passwordHash));
    check('verifyPassword rejects a wrong password', !(await authLib.verifyPassword('definitely-wrong', testUser.passwordHash)));

    const byId = await findUserById(testUser.userId);
    check('findUserById matches the record', Boolean(byId) && byId!.email === testEmail);

    const token = await generateToken({
      id: testUser.userId,
      userId: testUser.userId,
      email: testEmail,
      name: testUser.name,
      role: 'ADMIN',
    });
    const payload = await verifyToken(token);
    check('JWT signs and verifies', Boolean(payload) && payload!.userId === testUser.userId);

    try {
      const req = new Request('http://localhost/api/test', {
        headers: { authorization: `Bearer ${token}` },
      });
      const session = await authLib.getSession(req);
      check('getSession resolves the Bearer token', Boolean(session) && session!.role === 'ADMIN', session?.role || 'null');

      const perms = await import('../lib/permissions');
      const allowed = await perms.authorizeUser(['ADMIN'], req);
      check('RBAC allows ADMIN', allowed.authorized === true);
      const denied = await perms.authorizeUser(['THERAPIST'], req);
      check('RBAC denies a non-permitted role (403)', denied.authorized === false && denied.response?.status === 403);
    } catch (e: any) {
      skip('Next.js request-context auth checks', e?.message || 'unavailable outside Next runtime');
    }

    const jose = await import('jose');
    const expiredToken = await new jose.SignJWT({ userId: testUser.userId, role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('1s')
      .sign(new TextEncoder().encode(process.env.SESSION_SECRET || 'x'));
    await new Promise((r) => setTimeout(r, 1500));
    check('expired JWT is rejected', (await verifyToken(expiredToken)) === null);
  }

  // -------------------------------------------------------------- F. CRUD
  log('\n--- F. CRUD against the live database ---');
  let patient: any = null;
  const phone = `0300${String(Math.floor(1000000 + Math.random() * 8999999))}`;
  try {
    patient = await createPatient({
      fullName: `Phase Two Test ${RUN_ID}`,
      dateOfBirth: '1990-01-01',
      age: 35,
      gender: 'Other',
      phone,
      status: 'Active',
      createdBy: 'PHASE2-TEST',
    });
    check('createPatient inserts a row', Boolean(patient?.patientId), patient?.patientId);
  } catch (e: any) {
    check('createPatient inserts a row', false, e?.message);
  }

  if (patient) {
    try {
      const list = await listPatients({ search: RUN_ID, limit: 10 });
      check('listPatients finds it by search', list.data.some((p: any) => p.patientId === patient.patientId), `total=${list.total}`);
    } catch (e: any) {
      check('listPatients finds it by search', false, e?.message);
    }

    try {
      const conflict = await findPatientConflict(phone, undefined);
      check('findPatientConflict detects a duplicate phone', Boolean(conflict));
    } catch (e: any) {
      check('findPatientConflict detects a duplicate phone', false, e?.message);
    }

    try {
      const cascade = await createConsultationCascade({
        consultation: {
          patientId: patient.patientId,
          doctorName: 'DR SHAHAB MUHAMMAD',
          clinicianName: 'DR SHAHAB MUHAMMAD',
          chiefComplaint: 'Phase 2 verification',
          followUpDate: '',
        } as any,
        patient: {
          patientId: patient.patientId,
          fullName: patient.fullName,
          age: patient.age,
          gender: patient.gender,
          phone: patient.phone,
        },
        actorId: 'PHASE2-TEST',
      });
      check('consultation cascade creates the consultation', Boolean(cascade.consultation?.consultationId), cascade.consultation?.consultationId);
      check('cascade executed inside a transaction', cascade.transactional === true);
    } catch (e: any) {
      check('consultation cascade creates the consultation', false, e?.message);
    }

    let payment: any = null;
    try {
      payment = await recordPayment({
        patientId: patient.patientId,
        patientName: patient.fullName,
        amount: 1500,
        paymentMethod: 'Cash',
        paymentStatus: 'Paid',
        service: 'Phase 2 verification',
      } as any);
      check('recordPayment creates an immutable receipt', /^RCP-\d{4}-\d+/.test(payment?.receiptNumber || ''), payment?.receiptNumber);
    } catch (e: any) {
      check('recordPayment creates an immutable receipt', false, e?.message);
    }

    if (payment && pool) {
      let blocked = false;
      try {
        await pool.query('update payments set receipt_number = $1 where payment_id = $2', ['RCP-9999-9999', payment.paymentId]);
      } catch {
        blocked = true;
      }
      check('database trigger blocks receipt_number change', blocked);
    }

    try {
      const audit = await recordAuditEvent({
        userId: 'PHASE2-TEST',
        userName: 'Phase 2',
        userRole: 'SYSTEM',
        action: 'TEST',
        module: 'PHASE2',
        description: `phase2 run ${RUN_ID}`,
      } as any);
      check('recordAuditEvent writes an audit row', Boolean(audit?.logId), audit?.logId);
    } catch (e: any) {
      check('recordAuditEvent writes an audit row', false, e?.message);
    }

    try {
      const settings = await getClinicSettings();
      check('getClinicSettings returns the seeded singleton', Boolean(settings?.clinicName), settings?.clinicName);
    } catch (e: any) {
      check('getClinicSettings returns the seeded singleton', false, e?.message);
    }

    try {
      const soft = await softDeletePatient(patient.patientId, 'PHASE2-TEST');
      check('softDeletePatient deactivates, does not delete', soft?.isActive === false, `status=${soft?.status}`);
    } catch (e: any) {
      check('softDeletePatient deactivates, does not delete', false, e?.message);
    }
  }
  // ----------------------------------------------------------- G. cleanup
  log('\n--- G. Cleanup (removes ONLY rows created by this run) ---');
  if (pool) {
    try {
      if (patient?.patientId) {
        await pool.query('delete from prescriptions   where patient_id = $1', [patient.patientId]);
        await pool.query('delete from follow_ups      where patient_id = $1', [patient.patientId]);
        await pool.query('delete from consultations   where patient_id = $1', [patient.patientId]);
        await pool.query('delete from payments        where patient_id = $1', [patient.patientId]);
        await pool.query('delete from patients        where patient_id = $1', [patient.patientId]);
      }
      await pool.query('delete from audit_logs where log_id = $1 or user_id = $2 or description like $3', [
        txLog1,
        'PHASE2-TEST',
        `%${RUN_ID}%`,
      ]);
      await pool.query('delete from users where email = $1', [testEmail]);

      const left = await pool.query(`select
        (select count(*)::int from patients)       as patients,
        (select count(*)::int from users)          as users,
        (select count(*)::int from payments)       as payments,
        (select count(*)::int from consultations)  as consultations,
        (select count(*)::int from prescriptions)  as prescriptions,
        (select count(*)::int from audit_logs)     as audit_logs`);
      const r = left.rows[0];
      const empty =
        Number(r.patients) === 0 &&
        Number(r.users) === 0 &&
        Number(r.payments) === 0 &&
        Number(r.consultations) === 0 &&
        Number(r.prescriptions) === 0;
      check('cleanup leaves no test residue', empty, JSON.stringify(r));
    } catch (e: any) {
      check('cleanup leaves no test residue', false, e?.message);
    }
  } else {
    skip('cleanup', 'no pg pool');
  }

  log('\n====================================================================');
  log(` RESULT: ${state.pass} passed, ${state.fail} failed, ${state.skip} skipped`);
  log('====================================================================');
}





main()
  .catch((e) => {
    log(`\nFATAL: ${e?.message || e}`);
    state.fail += 1;
    try {
      flush();
    } catch {
      console.error(e);
    }
    process.exitCode = 1;
  })
  .finally(() => {
    flush();
  });
