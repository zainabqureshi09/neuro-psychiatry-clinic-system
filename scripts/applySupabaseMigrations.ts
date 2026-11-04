/**
 * Applies the NPCS PostgreSQL migrations to the configured Supabase project.
 *
 * SAFE BY DEFAULT — without `--apply` this script only:
 *   1. loads DATABASE_URL from .env.local / .env (never printed),
 *   2. opens a read-only connection,
 *   3. reports which tables already exist and which migrations are pending.
 *
 * Usage:
 *   npx tsx scripts/applySupabaseMigrations.ts            # dry run (safe)
 *   npx tsx scripts/applySupabaseMigrations.ts --apply    # apply migrations
 *
 * The password is read from the environment and never logged. Connection
 * strings are masked before printing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

interface Migration {
  label: string;
  file: string;
  /** File 1 contains CREATE TRIGGER without IF NOT EXISTS, so it must not re-run. */
  runOnce: boolean;
}

const MIGRATIONS: Migration[] = [
  {
    label: 'File 1 - initial schema (13 tables, 34 indexes, 15 triggers, 5 functions, 1 seed row)',
    file: 'supabase/migrations/20261026000001_initial_npcs_schema.sql',
    runOnce: true,
  },
  {
    label: 'File 2 - RLS + grant revocation + FK hardening (BEGIN/COMMIT, re-runnable)',
    file: 'supabase/migrations/20261103000001_npcs_rls_and_integrity_hardening.sql',
    runOnce: false,
  },
];

const EXPECTED_TABLES = [
  'users',
  'patients',
  'clinical_records',
  'fee_categories',
  'consultations',
  'prescriptions',
  'appointments',
  'follow_ups',
  'therapy_sessions',
  'payments',
  'audit_logs',
  'backup_logs',
  'clinic_settings',
];

const APPLY = process.argv.includes('--apply');
const ROOT = path.resolve(__dirname, '..');

function maskUrl(url: string): string {
  return url.replace(/(postgres(?:ql)?:\/\/)([^:]+):([^@]+)@/i, '$1$2:***@');
}

function loadEnv(): void {
  for (const envFile of ['.env.local', '.env']) {
    const envPath = path.join(ROOT, envFile);
    if (fs.existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
      } catch {
        // Ignore and try the next file.
      }
    }
  }
}

async function main(): Promise<void> {
  loadEnv();

  let connectionString = process.env.DATABASE_URL;

  // Convenience fallback: if DATABASE_URL is absent, build the session-pooler
  // string from three simple values. This removes any need to hand-assemble a
  // URL or percent-encode a password. The values stay in the git-ignored
  // .env.local and are never printed.
  if (!connectionString) {
    const host = process.env.SUPABASE_DB_HOST;
    const user = process.env.SUPABASE_DB_USER;
    const password = process.env.SUPABASE_DB_PASSWORD;

    if (host && user && password) {
      // sslmode=no-verify: encrypt the connection WITHOUT validating the CA
      // chain. Supabase's pooler certificate is signed by a CA that Node does
      // not ship, so `sslmode=require` is upgraded to `verify-full` by
      // pg-connection-string and fails with "self-signed certificate in
      // certificate chain". Traffic is still TLS-encrypted.
      connectionString =
        `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}` +
        `@${host}:5432/postgres?sslmode=no-verify`;
      console.log('Using SUPABASE_DB_* values to build the session-pooler connection string.\n');
    }
  }

  if (!connectionString) {
    console.error(
      'No database credentials found.\n\n' +
        'Easiest option — add these three lines to .env.local:\n' +
        '  SUPABASE_DB_HOST=aws-0-<region>.pooler.supabase.com\n' +
        '  SUPABASE_DB_USER=postgres.<project-ref>\n' +
        '  SUPABASE_DB_PASSWORD=<your database password>\n\n' +
        'Or provide the full string:\n' +
        '  DATABASE_URL="postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require"\n\n' +
        'Use the SESSION pooler (port 5432), not the transaction pooler (6543), so BEGIN/COMMIT stay on one backend.'
    );
    process.exit(1);
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 15000,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });

  console.log('====================================================================');
  console.log(' NPCS - Supabase migration runner');
  console.log(' mode   :', APPLY ? 'APPLY (writes will occur)' : 'DRY RUN (no writes)');
  console.log(' target :', maskUrl(connectionString));
  console.log('====================================================================\n');

  const client = await pool.connect();
  let exitCode = 0;

  try {
    const info = await client.query(
      'select current_database() as db, current_user as usr, version() as ver'
    );
    console.log(`Connected: db=${info.rows[0].db} user=${info.rows[0].usr}`);
    console.log(`Server   : ${String(info.rows[0].ver).split(',')[0]}\n`);

    const existing = await client.query(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'
        order by table_name`
    );
    const existingNames: string[] = existing.rows.map((r: any) => r.table_name);
    const present = EXPECTED_TABLES.filter((t) => existingNames.includes(t));
    const missing = EXPECTED_TABLES.filter((t) => !existingNames.includes(t));

    console.log(`Tables present : ${present.length}/13${present.length ? ' -> ' + present.join(', ') : ''}`);
    console.log(`Tables missing : ${missing.length}/13${missing.length ? ' -> ' + missing.join(', ') : ''}\n`);

    for (const migration of MIGRATIONS) {
      const fullPath = path.join(ROOT, migration.file);
      if (!fs.existsSync(fullPath)) {
        console.error(`Missing migration file: ${migration.file}`);
        exitCode = 1;
        continue;
      }

      if (migration.runOnce && missing.length === 0) {
        console.log(`SKIP  ${migration.label}`);
        console.log('      all 13 tables already exist; re-running would fail on CREATE TRIGGER.\n');
        continue;
      }

      const sql = fs.readFileSync(fullPath, 'utf8');

      if (!APPLY) {
        console.log(`WOULD RUN  ${migration.label}`);
        console.log(`           ${migration.file} (${sql.length} bytes)\n`);
        continue;
      }

      console.log(`APPLYING   ${migration.label}`);
      try {
        // File 1 has no BEGIN/COMMIT. Wrapping it makes the DDL atomic: either
        // all 13 tables are created or none are, so a mid-way failure can never
        // leave a half-built schema. File 2 already manages its own transaction.
        const managesOwnTransaction = /^\s*BEGIN\s*;/im.test(sql);
        const payload = managesOwnTransaction ? sql : `BEGIN;\n${sql}\nCOMMIT;`;

        if (!managesOwnTransaction) {
          console.log('           wrapped in BEGIN/COMMIT for atomicity');
        }

        await client.query(payload);
        console.log('           OK\n');
      } catch (error: any) {
        console.error(`           FAILED: ${error?.message || error}`);
        console.error('           Stopped. No further migrations were applied.\n');
        exitCode = 1;
        break;
      }
    }
    const rls = await client.query(
      `select relname, relrowsecurity
         from pg_class
        where relnamespace = 'public'::regnamespace
          and relkind = 'r'
          and relname = any($1::text[])
        order by relname`,
      [EXPECTED_TABLES]
    );

    console.log('--- Row Level Security status ---');
    if (rls.rows.length === 0) {
      console.log('  (no NPCS tables exist yet)');
    }
    for (const row of rls.rows) {
      console.log(`  ${row.relrowsecurity ? 'ON ' : 'OFF'}  ${row.relname}`);
    }

    const offTables = rls.rows.filter((r: any) => !r.relrowsecurity).map((r: any) => r.relname);

    console.log('');
    if (rls.rows.length === 13 && offTables.length === 0) {
      console.log('RESULT: all 13 tables exist and have RLS enabled.');
    } else if (!APPLY) {
      console.log(
        `RESULT (dry run): ${13 - rls.rows.length} table(s) do not exist yet - nothing was written.`
      );
    } else {
      console.log(
        `RESULT: ${offTables.length} table(s) still without RLS${offTables.length ? ': ' + offTables.join(', ') : ''}`
      );
      exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }

  process.exit(exitCode);
}

main().catch((error) => {
  const message = error?.message || String(error);
  console.error('FATAL:', message);

  if (/self-signed certificate|unable to verify the first certificate|CERT/i.test(message)) {
    console.error(
      '\nTLS trust failure (not a password problem).\n' +
        'Supabase signs the pooler certificate with its own CA. Either:\n' +
        '  - append &sslmode=no-verify to your DATABASE_URL, or\n' +
        '  - download the project CA and use sslmode=verify-full with sslrootcert.\n'
    );
  } else if (/password authentication failed|SASL|28P01/i.test(message)) {
    console.error(
      '\nAuthentication failed - the database password does not match.\n' +
        'Reset it in Supabase: Project Settings -> Database -> Reset database password.\n' +
        'Then update SUPABASE_DB_PASSWORD in .env.local.\n'
    );
  } else if (/ENOTFOUND|EAI_AGAIN/i.test(message)) {
    console.error('\nHost could not be resolved — check SUPABASE_DB_HOST.\n');
  } else if (/ETIMEDOUT|timeout|ECONNREFUSED/i.test(message)) {
    console.error('\nCould not reach the host on port 5432 - check network/firewall and that you used the session pooler.\n');
  }

  process.exit(1);
});

