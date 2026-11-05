import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getDatabaseConfig, maskUri } from './config';

/**
 * PostgreSQL Connection Pool & Atomic Transaction Management (Option A)
 * Uses pg.Pool for connection reuse and withTransaction for atomic operations.
 */

let pool: Pool | null = null;
let poolInitialized = false;

export function getPostgresPool(): Pool | null {
  if (pool) return pool;
  if (poolInitialized) return null;

  const config = getDatabaseConfig();
  const dbUrl = config.databaseUrl;

  if (!dbUrl) {
    return null;
  }

  try {
    // Managed providers (Supabase included) require TLS on every connection.
    // The previous NODE_ENV-based check meant development connections were made
    // WITHOUT TLS and rejected by the server. TLS is now enabled whenever the
    // target is not a local host.
    const isLocalHost = /localhost|127\.0\.0\.1|::1/.test(dbUrl);

    pool = new Pool({
      connectionString: dbUrl,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      // Encrypt without pinning the provider CA (Node does not ship Supabase's
      // certificate chain). Traffic is still TLS. For maximum assurance, supply
      // the project CA and use sslmode=verify-full.
      ssl: isLocalHost ? undefined : { rejectUnauthorized: false },
    });

    pool.on('error', (err) => {
      console.error('[PostgreSQL Pool] Idle client error:', err.message);
    });

    poolInitialized = true;
    return pool;
  } catch (err: any) {
    console.error(`[PostgreSQL Pool] Failed to initialize pool with ${maskUri(dbUrl)}:`, err.message);
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
