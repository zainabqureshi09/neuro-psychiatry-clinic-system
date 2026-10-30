import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getDatabaseConfig, maskSecret } from './config';

/**
 * Server-Side Supabase Client Management (Option A)
 * Uses @supabase/supabase-js with service role key for table operations.
 * Protects secrets and prevents unresolvable host calls.
 */

let supabaseClient: SupabaseClient | null = null;

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
    console.error(`[Supabase] Failed to initialize client for ${config.supabaseUrl}:`, err.message);
    return null;
  }
}

/**
 * Sets a custom or mock Supabase client for testing purposes
 */
export function setSupabaseClient(client: SupabaseClient | null): void {
  supabaseClient = client;
}
