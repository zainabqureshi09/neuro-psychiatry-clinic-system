/**
 * Verifies the Supabase credentials in .env.local WITHOUT ever printing them.
 *
 * Checks:
 *   1. SUPABASE_URL host + derived project reference
 *   2. publishable key  -> must be recognised by PostgREST
 *   3. secret key       -> must be recognised AND act as service_role (RLS bypass)
 *   4. session-pooler   -> TCP + SELECT 1 through pg
 *
 * Exit code 0 only when every check passes.
 *
 * Usage: npx tsx scripts/verifySupabaseCredentials.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const ROOT = path.resolve(__dirname, '..');

for (const envFile of ['.env.local', '.env']) {
  const p = path.join(ROOT, envFile);
  if (fs.existsSync(p)) {
    try {
      process.loadEnvFile(p);
    } catch {
      /* ignore */
    }
  }
}

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const PUBLISHABLE = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
const SECRET = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let failures = 0;

function line(ok: boolean | null, label: string, detail: string): void {
  const tag = ok === null ? '[SKIP]' : ok ? '[PASS]' : '[FAIL]';
  if (ok === false) failures += 1;
  console.log(`${tag} ${label.padEnd(34)} ${detail}`);
}

/** Never prints the key: only its shape. */
function shape(key: string): string {
  if (!key) return 'missing';
  const prefix = key.slice(0, 10);
  const body = key.length - prefix.length;
  const isJwt = key.startsWith('eyJ');
  return `prefix=${prefix} body=${body} chars${isJwt ? ' (legacy JWT)' : ''}`;
}

interface ProbeResult {
  status: number;
  code: string;
  empty: boolean;
}

async function probe(table: string, key: string): Promise<ProbeResult> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  let code = '';
  try {
    code = JSON.parse(text)?.code || '';
  } catch {
    /* not json */
  }
  return { status: res.status, code, empty: text.trim() === '' };
}

async function main(): Promise<void> {
  console.log('====================================================================');
  console.log(' NPCS - Supabase credential verification (secrets never printed)');
  console.log('====================================================================\n');

  // 1. URL
  let ref = '';
  try {
    const u = new URL(SUPABASE_URL);
    ref = u.hostname.split('.')[0];
    line(true, 'SUPABASE_URL', `${u.protocol}//${u.hostname}`);
    line(ref.length >= 10, 'project reference', `${ref} (${ref.length} chars)`);
  } catch {
    line(false, 'SUPABASE_URL', 'missing or not a valid URL');
  }

  line(PUBLISHABLE || !SECRET ? null : false, 'publishable key', shape(PUBLISHABLE));
  line(null, 'secret key', shape(SECRET));

  if (!SUPABASE_URL) {
    console.error('\nCannot continue without SUPABASE_URL.');
    process.exit(1);
  }

  // 2. publishable key must be recognised (any JSON error body = recognised)
  try {
    const r = await probe('users', PUBLISHABLE);
    const recognised = !(r.status === 401 && r.empty);
    line(
      recognised,
      'publishable key recognised',
      recognised ? `HTTP ${r.status}${r.code ? ' code=' + r.code : ''}` : 'HTTP 401 with empty body (rejected by gateway)'
    );
  } catch (e: any) {
    line(false, 'publishable key recognised', `network error: ${e?.message}`);
  }

  // 3. secret key must be recognised AND act as service_role
  try {
    const r = await probe('users', SECRET);
    if (r.status === 200) {
      line(true, 'secret key recognised', 'HTTP 200 (service_role, RLS bypassed)');
    } else if (r.status === 401 && r.empty) {
      line(false, 'secret key recognised', 'HTTP 401 empty body - REJECTED by API gateway (invalid, truncated, or wrong project)');
    } else if (r.code === '42501') {
      line(false, 'secret key recognised', `HTTP ${r.status} code=42501 - key is valid but NOT service_role (wrong key type)`);
    } else {
      line(false, 'secret key recognised', `HTTP ${r.status} code=${r.code || 'none'}`);
    }
  } catch (e: any) {
    line(false, 'secret key recognised', `network error: ${e?.message}`);
  }

  // 4. session pooler
  const host = process.env.SUPABASE_DB_HOST;
  const user = process.env.SUPABASE_DB_USER;
  const pass = process.env.SUPABASE_DB_PASSWORD;
  if (host && user && pass) {
    const pool = new Pool({
      connectionString: `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:5432/postgres?sslmode=no-verify`,
      max: 1,
      connectionTimeoutMillis: 15000,
      ssl: { rejectUnauthorized: false },
    });
    try {
      const c = await pool.connect();
      try {
        const r = await c.query('select current_database() as db, current_user as usr');
        line(true, 'session pooler', `${host} -> db=${r.rows[0].db} user=${r.rows[0].usr}`);
      } finally {
        c.release();
      }
    } catch (e: any) {
      line(false, 'session pooler', e?.message);
    } finally {
      await pool.end().catch(() => undefined);
    }
  } else {
    line(null, 'session pooler', 'SUPABASE_DB_* not configured');
  }

  console.log(`\n${failures === 0 ? 'RESULT: all credential checks passed.' : `RESULT: ${failures} check(s) FAILED.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e);
  process.exit(1);
});
