/**
 * Phase 2b - LIVE Express API verification (single authoritative API).
 *
 * Imports the real Express app with SKIP_SERVER_START=true so `startServer()`
 * (which auto-seeds demo staff accounts) never runs. Then listens on a temporary
 * port and issues real HTTP requests.
 *
 * Creates ONE tagged temporary staff account, then deletes it and its audit rows.
 * Writes scratch/express-report.txt.
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

process.env.SKIP_SERVER_START = 'true';

const RUN_ID = `EX${Date.now().toString(36).toUpperCase()}`;
const PORT = 5077;
const REPORT: string[] = [];
const st = { pass: 0, fail: 0 };

const log = (s = '') => REPORT.push(s);
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) st.pass += 1;
  else st.fail += 1;
  log(`${ok ? '[PASS]' : '[FAIL]'} ${name}${detail ? ' :: ' + detail : ''}`);
}
function flush(): void {
  fs.writeFileSync(
    path.resolve(__dirname, '..', 'scratch', 'express-report.txt'),
    REPORT.join('\n') + '\n',
    'utf8'
  );
}

async function main(): Promise<void> {
  log('====================================================================');
  log(` NPCS - Express authoritative API verification  (run ${RUN_ID})`);
  log(` ${new Date().toISOString()}`);
  log('====================================================================');

  const { default: app } = await import('../backend/server');
  const { createUser } = await import('../lib/db/repositories/userRepository');
  const { generateToken } = await import('../backend/utils/authUtils');
  const { getPostgresPool } = await import('../lib/db');

  const email = `${RUN_ID.toLowerCase()}@apitest.local`;
  let user: any = null;
  try {
    user = await createUser({
      name: 'Express API Test',
      email,
      password: 'ApiTest!2026',
      role: 'ADMIN',
      title: 'QA',
      department: 'QA',
    });
    log(`\ntemporary QA account created (deleted at the end): ${user.userId}\n`);
  } catch (e: any) {
    check('temporary QA account created', false, e?.message);
  }

  const server = app.listen(PORT);
  await new Promise((r) => server.once('listening', r));

  const base = `http://127.0.0.1:${PORT}`;
  const req = async (p: string, init: RequestInit = {}) => {
    const res = await fetch(base + p, init);
    const text = await res.text();
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    return { status: res.status, body, headers: res.headers };
  };

  log('--- Health & security headers ---');
  const root = await req('/');
  check('GET / returns 200', root.status === 200);
  check('health reports provider=postgres', root.body?.database?.provider === 'postgres', String(root.body?.database?.provider));
  check('security headers present', Boolean(root.headers.get('x-content-type-options') || root.headers.get('x-frame-options')));

  const health = await req('/api/health');
  check('GET /api/health returns 200', health.status === 200);

  log('\n--- Authentication required ---');
  const noAuth = await req('/api/patients');
  check('GET /api/patients without token -> 401', noAuth.status === 401, `HTTP ${noAuth.status}`);
  const noAuthReports = await req('/api/reports');
  check('GET /api/reports without token -> 401', noAuthReports.status === 401, `HTTP ${noAuthReports.status}`);

  flush();
  await runAuthedAndFinish(app, server, req, user, email);
}

async function runAuthedAndFinish(
  app: any,
  server: any,
  req: (p: string, init?: RequestInit) => Promise<{ status: number; body: any; headers: Headers }>,
  user: any,
  email: string
): Promise<void> {
  const { generateToken } = await import('../backend/utils/authUtils');
  const { getPostgresPool } = await import('../lib/db');

  if (user) {
    const token = await generateToken({
      id: user.userId,
      userId: user.userId,
      email,
      name: user.name,
      role: 'ADMIN',
    });
    const auth = { authorization: `Bearer ${token}` };

    log('\n--- Endpoints used by the frontend ---');

    const search = await req(`/api/patients?q=${encodeURIComponent('zzz-none')}`, { headers: auth });
    check('GET /api/patients?q= (GlobalSearchModal) -> 200', search.status === 200, `HTTP ${search.status}`);
    check('search response has success/data contract', search.body?.success === true && Array.isArray(search.body?.data));

    const list = await req('/api/patients?search=&gender=&status=&page=1&limit=20', { headers: auth });
    check('GET /api/patients (paginated) -> 200', list.status === 200, `HTTP ${list.status}`);
    check('pagination contract present', Boolean(list.body?.pagination));

    const reports = await req('/api/reports', { headers: auth });
    check('GET /api/reports (ReportsScreen) -> 200', reports.status === 200, `HTTP ${reports.status}`);
    check('reports payload has summary', Boolean(reports.body?.data?.summary), JSON.stringify(reports.body?.data?.summary || {}).slice(0, 90));

    const daily = await req('/api/reports/collections/daily', { headers: auth });
    check('GET /api/reports/collections/daily -> 200', daily.status === 200, `HTTP ${daily.status}`);

    const settings = await req('/api/settings', { headers: auth });
    check('GET /api/settings -> 200', settings.status === 200, `HTTP ${settings.status}`);

    const audit = await req('/api/audit-logs?limit=5', { headers: auth });
    check('GET /api/audit-logs -> 200', audit.status === 200, `HTTP ${audit.status}`);

    // Role comes from the DATABASE record, not the token claim, so a THERAPIST
    // must be a real THERAPIST account - a forged role in a token cannot escalate.
    const { createUser: createUserRepo } = await import('../lib/db/repositories/userRepository');
    const tEmail = `${RUN_ID.toLowerCase()}-therapist@apitest.local`;
    const therapistUser = await createUserRepo({
      name: 'Express API Test Therapist',
      email: tEmail,
      password: 'ApiTest!2026',
      role: 'THERAPIST',
      title: 'QA',
      department: 'QA',
    });
    const therapistToken = await generateToken({
      id: therapistUser.userId,
      userId: therapistUser.userId,
      email: tEmail,
      name: therapistUser.name,
      role: 'THERAPIST',
    });
    const denied = await req('/api/reports', { headers: { authorization: `Bearer ${therapistToken}` } });
    check('real THERAPIST blocked from /api/reports -> 403', denied.status === 403, `HTTP ${denied.status}`);

    const therapistSettings = await req('/api/users', { headers: { authorization: `Bearer ${therapistToken}` } });
    check('real THERAPIST blocked from /api/users -> 403', therapistSettings.status === 403, `HTTP ${therapistSettings.status}`);
  }

  log('\n--- CORS for browser calls ---');
  const cors = await req('/api/patients', {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  const acao = cors.headers.get('access-control-allow-origin');
  const acac = cors.headers.get('access-control-allow-credentials');
  check('preflight allows localhost:3000', acao === 'http://localhost:3000' || acao === '*', String(acao));
  check('preflight allows credentials', acac === 'true', String(acac));

  log('\n--- Login route ---');
  const badLogin = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: `${RUN_ID.toLowerCase()}-nobody@invalid.test`, password: 'WrongPass123!' }),
  });
  check('POST /api/auth/login invalid creds -> 401', badLogin.status === 401, `HTTP ${badLogin.status}`);

  const goodLogin = await req('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'ApiTest!2026' }),
  });
  check('POST /api/auth/login valid creds -> 200', goodLogin.status === 200, `HTTP ${goodLogin.status}`);
  check('login returns payload without password hash', goodLogin.body?.data?.role === 'ADMIN' && !JSON.stringify(goodLogin.body).includes('$2'));
  const setCookie = goodLogin.headers.get('set-cookie') || '';
  check('login sets httpOnly session cookie', /psychiatrist_session=/.test(setCookie) && /HttpOnly/i.test(setCookie));

  log('\n--- Cleanup ---');
  await new Promise((r) => server.close(r));

  // Audit writes are intentionally non-blocking (fire-and-forget), so give them
  // a moment to land before deleting, otherwise rows arrive after the DELETE.
  await new Promise((r) => setTimeout(r, 2000));

  const pool = getPostgresPool();
  if (pool) {
    await pool.query(
      `delete from audit_logs
        where user_id in (select user_id from users where email like $1)
           or user_name like $2
           or description like $3
           or description like $4
           or description like $5`,
      ['%@apitest.local', 'Express API Test%', `%${RUN_ID}%`, `%${RUN_ID.toLowerCase()}%`, '%invalid.test%']
    );
    await pool.query('delete from users where email like $1', ['%@apitest.local']);
    const left = await pool.query(
      `select (select count(*)::int from users) as users,
              (select count(*)::int from patients) as patients,
              (select count(*)::int from audit_logs
                where user_name like 'Express API Test%'
                   or description like '%apitest.local%') as test_audit_rows`
    );
    const r = left.rows[0];
    check(
      'no test residue remains',
      Number(r.users) === 0 && Number(r.patients) === 0 && Number(r.test_audit_rows) === 0,
      JSON.stringify(r)
    );
  }

  log('\n====================================================================');
  log(` RESULT: ${st.pass} passed, ${st.fail} failed`);
  log('====================================================================');
  flush();
  process.exit(st.fail === 0 ? 0 : 1);
}

main().catch((e) => {
  check('suite completed', false, e?.message || String(e));
  flush();
  process.exit(1);
});

