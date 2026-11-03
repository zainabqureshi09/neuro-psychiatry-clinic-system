import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getDatabaseConfig, maskUri } from './config';
import { DatabaseUnavailableError } from './errors';

/**
 * Server-Side Supabase Client Management (Option A)
 * Uses @supabase/supabase-js with service role key for table operations.
 * Protects secrets and prevents unresolvable host calls.
 */

let supabaseClient: SupabaseClient | null = null;
let clientInjected = false;

export function getSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient;

  const config = getDatabaseConfig();
  if (!config.isSupabaseConfigured || !config.supabaseUrl || !config.supabaseSecretKey) {
    return null;
  }

  // Check for dummy or placeholder hosts
  try {
    const url = new URL(config.supabaseUrl);
    if (url.hostname.includes('your-project-id')) {
      return null;
    }

    supabaseClient = createClient(config.supabaseUrl, config.supabaseSecretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    return supabaseClient;
  } catch (err: any) {
    console.error(`[Supabase] Failed to initialize client for ${maskUri(config.supabaseUrl)}:`, err.message);
    return null;
  }
}

/**
 * Requires an initialized client or fails with a typed 503 error.
 * Used by code paths that cannot fall back to the legacy MongoDB layer.
 */
export function requireSupabaseClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) {
    throw new DatabaseUnavailableError(
      'Supabase client is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY, or use the MongoDB fallback.'
    );
  }
  return client;
}

/**
 * Sets a custom or mock Supabase client for testing purposes
 */
export function setSupabaseClient(client: SupabaseClient | null): void {
  supabaseClient = client;
  clientInjected = client !== null;
}

/**
 * True when a client was injected by tests, which bypasses DNS reachability
 * probes (no network access is required or expected for unit-level validation).
 */
export function hasSupabaseClientOverride(): boolean {
  return clientInjected;
}

/**
 * Releases the memoized client (used by tests and graceful shutdown).
 */
export function resetSupabaseClient(): void {
  supabaseClient = null;
  clientInjected = false;
}

