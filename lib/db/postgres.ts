import fs from 'node:fs';
import tls from 'node:tls';
import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { getDatabaseConfig, maskUri } from './config';

/**
 * PostgreSQL Connection Pool & Atomic Transaction Management (Option A)
 * Uses pg.Pool for connection reuse and withTransaction for atomic operations.
 */

let pool: Pool | null = null;
let poolInitialized = false;

/**
 * Builds the pg.Pool configuration with strict TLS certificate & hostname verification.
 *
 * IMPORTANT: `pg` internally runs `Object.assign({}, config, parse(config.connectionString))`
 * where `pg-connection-string` overwrites `config.ssl` whenever `sslmode`, `ssl`, or
 * `sslrootcert` is present in the URL query string. We strip those parameters from
 * `connectionString` after inspecting them so `ssl` is never silently downgraded or wiped.
 */
export function buildPostgresPoolConfig(
  dbUrl: string,
  env: NodeJS.ProcessEnv = process.env
): PoolConfig {
  let sanitizedConnectionString = dbUrl;
  let targetHost = '';
  let urlSslMode = '';
  let urlSslRootCert = '';

  try {
    const parsed = new URL(dbUrl);
    targetHost = parsed.hostname;
    urlSslMode = (parsed.searchParams.get('sslmode') || '').toLowerCase();
    urlSslRootCert = parsed.searchParams.get('sslrootcert') || '';

    for (const param of [
      'sslmode',
      'ssl',
      'sslrootcert',
      'sslcert',
      'sslkey',
      'uselibpqcompat',
    ]) {
      parsed.searchParams.delete(param);
    }
    sanitizedConnectionString = parsed.toString();
  } catch {
    const hostMatch = dbUrl.match(/@([^:/?#]+)/);
    if (hostMatch) targetHost = hostMatch[1];
  }

  const isLocalHost =
    targetHost === 'localhost' ||
    targetHost === '127.0.0.1' ||
    targetHost === '::1' ||
    /localhost|127\.0\.0\.1|::1/.test(dbUrl);

  let sslOption: tls.ConnectionOptions | boolean | undefined = undefined;

  if (!isLocalHost) {
    const caPath = env.SUPABASE_SSL_CA_PATH || urlSslRootCert;
    const caCertRaw = env.SUPABASE_SSL_CA;
    const isProd = env.NODE_ENV === 'production';
    const requiresStrictVerify =
      isProd || urlSslMode === 'verify-full' || urlSslMode === 'verify-ca';

    let caPem: string | undefined;

    if (caPath) {
      if (!fs.existsSync(/*turbopackIgnore: true*/ caPath)) {
        throw new Error(
          `PostgreSQL TLS CA certificate file not found at path: ${caPath}`
        );
      }
      caPem = fs.readFileSync(/*turbopackIgnore: true*/ caPath, 'utf8');
    } else if (caCertRaw && caCertRaw.trim().length > 0) {
      caPem = caCertRaw.includes('-----BEGIN CERTIFICATE-----')
        ? caCertRaw.replace(/\\n/g, '\n')
        : Buffer.from(caCertRaw.trim(), 'base64').toString('utf8');
    }

    if (caPem) {
      if (!caPem.includes('-----BEGIN CERTIFICATE-----')) {
        throw new Error(
          'PostgreSQL TLS CA configuration does not contain a valid PEM certificate.'
        );
      }
      sslOption = {
        ca: caPem,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        servername: targetHost || undefined,
        checkServerIdentity: (host: string, cert: tls.PeerCertificate) => {
          return tls.checkServerIdentity(host || targetHost, cert);
        },
      };
    } else if (requiresStrictVerify) {
      throw new Error(
        'FATAL TLS CONFIGURATION ERROR: Production PostgreSQL connections (or sslmode=verify-full) require SUPABASE_SSL_CA_PATH, SUPABASE_SSL_CA, or sslrootcert to enforce CA certificate and hostname verification (rejectUnauthorized: true).'
      );
    } else {
      // Non-production fallback when no local CA bundle is configured in .env.local
      sslOption = { rejectUnauthorized: false };
    }
  }

  return {
    connectionString: sanitizedConnectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: sslOption,
  };
}

export function getPostgresPool(): Pool | null {
  if (pool) return pool;
  if (poolInitialized) return null;

  const config = getDatabaseConfig();
  const dbUrl = config.databaseUrl;

  if (!dbUrl) {
    return null;
  }

  try {
    const poolConfig = buildPostgresPoolConfig(dbUrl, process.env);
    pool = new Pool(poolConfig);

    pool.on('error', (err) => {
      console.error('[PostgreSQL Pool] Idle client error:', err.message);
    });

    poolInitialized = true;
    return pool;
  } catch (err: any) {
    console.error(`[PostgreSQL Pool] Failed to initialize pool with ${maskUri(dbUrl)}:`, err.message);
    if (process.env.NODE_ENV === 'production') {
      throw err;
    }
    return null;
  }
}

/**
 * Sets a custom or mock Pool for testing purposes
 */
export function setPostgresPool(customPool: Pool | null): void {
  pool = customPool;
  poolInitialized = Boolean(customPool);
}

/**
 * Closes the PostgreSQL connection pool gracefully
 */
export async function closePostgresPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    poolInitialized = false;
  }
}

/**
 * Executes a callback within a managed PostgreSQL transaction.
 * Issues BEGIN, executes callback, and COMMITs.
 * If callback throws, issues ROLLBACK and rethrows the error.
 * Client is unconditionally released in a finally block.
 */
export async function withTransaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const currentPool = getPostgresPool();
  if (!currentPool) {
    throw new Error(
      'PostgreSQL connection pool is not available. Ensure DATABASE_URL is properly configured.'
    );
  }

  const client = await currentPool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr: any) {
      console.error('[PostgreSQL Transaction] Rollback error:', rollbackErr.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Executes a single parameterized query against the connection pool
 */
export async function query<R extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<R>> {
  const currentPool = getPostgresPool();
  if (!currentPool) {
    throw new Error('PostgreSQL connection pool is not available.');
  }
  return currentPool.query<R>(text, params);
}

/**
 * Verifies that the configured pool can actually serve a trivial query.
 * Used by health/diagnostics endpoints - never throws.
 */
export async function checkPostgresConnection(): Promise<boolean> {
  const currentPool = getPostgresPool();
  if (!currentPool) return false;

  try {
    const client = await currentPool.connect();
    try {
      await client.query('SELECT 1');
      return true;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error('[PostgreSQL Pool] Health check failed:', err?.message || err);
    return false;
  }
}
