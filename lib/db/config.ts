import dns from 'node:dns/promises';

/**
 * NPCS Database Configuration & Credential Protection
 * Manages Supabase JavaScript client, PostgreSQL pg Pool, and MongoDB fallback.
 */

export type DatabaseProvider = 'postgres' | 'supabase' | 'mongodb';

export interface DatabaseConfig {
  provider: DatabaseProvider;
  supabaseUrl?: string;
  supabaseSecretKey?: string;
  databaseUrl?: string;
  isSupabaseConfigured: boolean;
  isPostgresConfigured: boolean;
  isMongoConfigured: boolean;
  supabaseHostValid: boolean;
}

/**
 * Masks database URIs and secrets for safe logging
 */
export function maskSecret(secret?: string | null): string {
  if (!secret) return '(none)';
  if (secret.length <= 8) return '****';
  return `${secret.substring(0, 4)}...${secret.substring(secret.length - 4)}`;
}

export function maskUri(uri?: string | null): string {
  if (!uri) return '(none)';
  return uri
    .replace(/(postgres(?:ql)?:\/\/)([^:]+):([^@]+)@/i, '$1***:***@')
    .replace(/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/i, '$1***:***@');
}

/**
 * Validates whether a hostname resolves via DNS
 */
export async function validateHostname(hostname: string): Promise<boolean> {
  // Common placeholders or known broken hostnames
  if (
    !hostname ||
    hostname.includes('your-project-id') ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  ) {
    return true; // Localhost is considered resolvable locally
  }

  try {
    const addresses = await dns.lookup(hostname);
    return Boolean(addresses && addresses.address);
  } catch (err: any) {
    return false;
  }
}

/**
 * Detects and returns the active database configuration
 */
export function getDatabaseConfig(): DatabaseConfig {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URI;
  const mongoUri = process.env.MONGODB_URI;

  const isSupabaseConfigured = Boolean(
    supabaseUrl &&
    supabaseSecretKey &&
    !supabaseUrl.includes('your-project-id') &&
    !supabaseSecretKey.includes('your_secret_key')
  );

  const isPostgresConfigured = Boolean(
    databaseUrl &&
    !databaseUrl.includes('your-db-host')
  );

  const isMongoConfigured = Boolean(mongoUri);

  // Check explicit provider override
  let provider: DatabaseProvider = 'mongodb';
  const explicitProvider = process.env.DB_PROVIDER?.toLowerCase();

  if (explicitProvider === 'postgres' || explicitProvider === 'supabase') {
    provider = explicitProvider;
  } else if (isPostgresConfigured) {
    provider = 'postgres';
  } else if (isSupabaseConfigured) {
    provider = 'supabase';
  } else {
    provider = 'mongodb';
  }

  return {
    provider,
    supabaseUrl,
    supabaseSecretKey,
    databaseUrl,
    isSupabaseConfigured,
    isPostgresConfigured,
    isMongoConfigured,
    supabaseHostValid: false, // Default false until verified
  };
}

let cachedHostStatus: { [host: string]: boolean } = {};

/**
 * Checks if Supabase host is genuinely resolvable and alive before any connection attempt
 */
export async function isSupabaseReachable(): Promise<boolean> {
  const config = getDatabaseConfig();
  if (!config.isSupabaseConfigured || !config.supabaseUrl) {
    return false;
  }

  try {
    const url = new URL(config.supabaseUrl);
    const host = url.hostname;

    if (cachedHostStatus[host] !== undefined) {
      return cachedHostStatus[host];
    }

    const isValid = await validateHostname(host);
    cachedHostStatus[host] = isValid;

    if (!isValid) {
      console.warn(
        `[Database] Notice: Supabase host '${host}' is currently unresolvable via DNS. Live Supabase connection will not be attempted.`
      );
    }

    return isValid;
  } catch (err) {
    return false;
  }
}
