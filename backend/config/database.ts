import mongoose from "mongoose";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../utils/logger";
import {
  DatabaseProvider,
  getDatabaseConfig,
  isSupabaseReachable,
  getSupabaseClient,
  getPostgresPool,
  checkPostgresConnection,
  closePostgresPool,
} from "../../lib/db";

/**
 * Sanitizes MongoDB / PostgreSQL connection URIs to mask sensitive credentials
 * (username/password) before logging to stdout/stderr.
 */
export const sanitizeUri = (uri: string): string => {
  return uri
    .replace(/mongodb(\+srv)?:\/\/([^:]+):([^@]+)@/g, "mongodb$1://***:***@")
    .replace(/postgres(ql)?:\/\/([^:]+):([^@]+)@/g, "postgres$1://***:***@");
};

/**
 * Sanitizes error messages to ensure database credentials are never leaked in error logs.
 */
export const sanitizeMessage = (message: string, rawUri?: string): string => {
  let cleaned = message;
  if (rawUri) {
    cleaned = cleaned.replace(rawUri, sanitizeUri(rawUri));
  }
  return sanitizeUri(cleaned);
};

/**
 * Loads environment variables from .env.local or .env when no database
 * configuration has been provided by the process environment.
 */
const loadEnvIfMissing = (): void => {
  const hasAnyConfig = Boolean(
    process.env.MONGODB_URI || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  );
  if (hasAnyConfig) return;

  for (const envFile of [".env.local", ".env"]) {
    const envPath = path.resolve(process.cwd(), envFile);
    if (fs.existsSync(envPath)) {
      try {
        process.loadEnvFile(envPath);
        if (process.env.MONGODB_URI || process.env.SUPABASE_URL) break;
      } catch {
        // Ignore and check next file
      }
    }
  }
};

let listenersAttached = false;

const setupConnectionListeners = (): void => {
  if (listenersAttached) return;
  listenersAttached = true;

  mongoose.connection.on("connected", () => {
    logger.info("MongoDB Mongoose connection established successfully.");
  });

  mongoose.connection.on("error", (err) => {
    const rawMsg = err.message || String(err);
    logger.error("MongoDB connection runtime error:", sanitizeMessage(rawMsg, process.env.MONGODB_URI));
  });

  mongoose.connection.on("disconnected", () => {
    logger.warn("MongoDB connection disconnected.");
  });
};

/**
 * Connects to the active database provider.
 *
 * - MongoDB provider: unchanged Mongoose connection behaviour.
 * - PostgreSQL provider: validates the Supabase project host (DNS) and refuses
 *   to open any live connection against an unresolvable hostname. The `pg`
 *   transaction pool is optional and only reported (never fatal) at startup.
 */
export const connectDatabase = async (): Promise<void> => {
  loadEnvIfMissing();

  const config = getDatabaseConfig();

  if (config.provider === "mongodb") {
    const mongoUri = process.env.MONGODB_URI;

    if (!mongoUri) {
      const errorMsg = "MONGODB_URI environment variable is not defined. Server database connection aborted.";
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    const maskedUri = sanitizeUri(mongoUri);
    logger.info(`Attempting MongoDB connection to ${maskedUri}`);

    setupConnectionListeners();

    try {
      await mongoose.connect(mongoUri);
      return;
    } catch (error: any) {
      const rawMsg = error.message || String(error);
      logger.error(`Failed to connect to MongoDB (${maskedUri}):`, sanitizeMessage(rawMsg, mongoUri));
      throw new Error(`Database connection failed: ${sanitizeMessage(rawMsg, mongoUri)}`);
    }
  }

  // PostgreSQL (Supabase) provider
  if (!config.isSupabaseConfigured) {
    throw new Error(
      "PostgreSQL provider selected but SUPABASE_URL / SUPABASE_SECRET_KEY are missing. Refusing to start with an ambiguous database configuration."
    );
  }

  const reachable = await isSupabaseReachable();
  if (!reachable) {
    throw new Error(
      "Supabase project host could not be resolved via DNS. Live PostgreSQL access is disabled until the hostname is valid (no connection was attempted)."
    );
  }

  if (!getSupabaseClient()) {
    throw new Error("Unable to initialize the Supabase client for the configured project.");
  }

  logger.info("PostgreSQL provider ready (Supabase client initialized).");

  if (getPostgresPool()) {
    const transactionsReady = await checkPostgresConnection();
    if (transactionsReady) {
      logger.info("PostgreSQL pg transaction pool verified.");
    } else {
      logger.warn(
        "PostgreSQL pg transaction pool configured but not reachable. Atomic multi-entity writes will fall back to sequential Supabase operations."
      );
    }
  } else {
    logger.warn(
      "DATABASE_URL is not configured: payments, appointment booking and consultation cascades will run without an explicit SQL transaction."
    );
  }
};

/**
 * Gracefully closes the MongoDB connection and the pg transaction pool.
 */
export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    logger.info("MongoDB connection closed gracefully.");
  }

  try {
    await closePostgresPool();
  } catch (error: any) {
    logger.warn("Error closing PostgreSQL pool:", error?.message || error);
  }
};

/**
 * Synchronous MongoDB connection check (kept for backward compatibility).
 */
export const isDatabaseConnected = (): boolean => {
  return mongoose.connection.readyState === 1;
};

export interface BackendDatabaseHealth {
  provider: DatabaseProvider;
  status: "connected" | "disconnected" | "degraded";
  ready: boolean;
  transactions: boolean;
}

/**
 * Provider-aware readiness probe used by GET /api/health.
 * Never attempts a live connection against an unresolvable Supabase host.
 */
export const getBackendDatabaseHealth = async (): Promise<BackendDatabaseHealth> => {
  const config = getDatabaseConfig();

  if (config.provider === "mongodb") {
    const connected = isDatabaseConnected();
    return {
      provider: "mongodb",
      status: connected ? "connected" : "disconnected",
      ready: connected,
      transactions: false,
    };
  }

  const reachable = await isSupabaseReachable();
  const clientReady = Boolean(reachable && getSupabaseClient());
  const transactions = getPostgresPool() ? await checkPostgresConnection() : false;

  return {
    provider: "postgres",
    status: clientReady ? "connected" : "disconnected",
    ready: clientReady,
    transactions,
  };
};
