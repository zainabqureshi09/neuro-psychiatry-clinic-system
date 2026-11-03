import dbConnect from '@/lib/dbConnect';
import {
  DatabaseProvider,
  getDatabaseConfig,
  describeDatabaseConfig,
  isSupabaseReachable,
} from './config';
import { DatabaseUnavailableError } from './errors';
import { getSupabaseClient, hasSupabaseClientOverride } from './supabase';
import { checkPostgresConnection, getPostgresPool } from './postgres';

export * from './config';
export * from './errors';
export * from './postgres';
export * from './supabase';
export * from './mapper';
export * from './repositories';

/**
 * Establishes (or verifies) the storage layer required by the active provider.
 *
 * Replace `await dbConnect()` with `await ensureDatabaseReady()` in route
 * handlers so that PostgreSQL mode never opens a MongoDB connection, and so
 * MongoDB mode keeps working exactly as before.
 */
export async function ensureDatabaseReady(): Promise<DatabaseProvider> {
  const config = getDatabaseConfig();

  if (config.provider === 'mongodb') {
    await dbConnect();
    return 'mongodb';
  }

  // Injected clients (tests) bypass network probes entirely.
  if (hasSupabaseClientOverride()) {
    if (!getSupabaseClient()) {
      throw new DatabaseUnavailableError('Supabase client override is not initialized.');
    }
    return 'postgres';
  }

  if (!config.isSupabaseConfigured) {
    throw new DatabaseUnavailableError(
      'PostgreSQL storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.'
    );
  }

  if (process.env.DB_SKIP_REACHABILITY_CHECK !== 'true') {
    const reachable = await isSupabaseReachable();
    if (!reachable) {
      // Never attempt a live connection against an unresolvable host.
      throw new DatabaseUnavailableError(
        'The configured Supabase project host could not be resolved. Live PostgreSQL access is disabled until the hostname is valid.'
      );
    }
  }

  if (!getSupabaseClient()) {
    throw new DatabaseUnavailableError('Unable to initialize the Supabase client for the configured project.');
  }

  return 'postgres';
}

/**
 * Non-throwing diagnostics snapshot for health endpoints and the review report.
 * Never exposes credentials - only booleans and the provider name.
 */
export async function getDatabaseStatus(): Promise<{
  provider: DatabaseProvider;
  supabaseConfigured: boolean;
  supabaseReachable: boolean | null;
  transactionsAvailable: boolean;
  mongodbFallbackConfigured: boolean;
  summary: string;
}> {
  const config = getDatabaseConfig();

  let supabaseReachable: boolean | null = null;
  if (config.provider === 'postgres') {
    supabaseReachable = hasSupabaseClientOverride() ? true : await isSupabaseReachable();
  }

  let transactionsAvailable = Boolean(getPostgresPool());
  if (transactionsAvailable) {
    // Only report true when a trivial query succeeds.
    transactionsAvailable = await checkPostgresConnection();
  }

  return {
    provider: config.provider,
    supabaseConfigured: config.isSupabaseConfigured,
    supabaseReachable,
    transactionsAvailable,
    mongodbFallbackConfigured: config.isMongoConfigured,
    summary: describeDatabaseConfig(),
  };
}

