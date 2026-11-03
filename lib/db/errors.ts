/**
 * NPCS Database Error Taxonomy
 * Normalizes database-layer failures into a small set of typed errors so that
 * both the Express API and the Next.js route handlers can return consistent
 * HTTP status codes without leaking SQL, credentials, or stack traces.
 */

export class DatabaseError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 500, code = 'DATABASE_ERROR') {
    super(message);
    this.name = 'DatabaseError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Raised when no PostgreSQL/Supabase connection is available. */
export class DatabaseUnavailableError extends DatabaseError {
  constructor(message = 'Database is not available. Please verify the PostgreSQL configuration.') {
    super(message, 503, 'DATABASE_UNAVAILABLE');
    this.name = 'DatabaseUnavailableError';
  }
}

/** Raised when a requested record does not exist. */
export class RecordNotFoundError extends DatabaseError {
  constructor(message = 'Record not found.') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'RecordNotFoundError';
  }
}

/** Raised for invalid input that reaches the data layer. */
export class InvalidDataError extends DatabaseError {
  constructor(message = 'Invalid data supplied.') {
    super(message, 400, 'INVALID_DATA');
    this.name = 'InvalidDataError';
  }
}

/** Raised when a unique constraint / scheduling conflict is detected. */
export class ConflictError extends DatabaseError {
  constructor(message = 'Conflicting record detected.') {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

const POSTGRES_UNIQUE_VIOLATION = '23505';
const POSTGRES_FK_VIOLATION = '23503';
const POSTGRES_CHECK_VIOLATION = '23514';

/**
 * Converts an unknown thrown value into a safe { statusCode, message } pair.
 * Never returns raw database internals (connection strings, SQL text).
 */
export function normalizeDatabaseError(error: unknown, fallbackMessage = 'A database error occurred.'): {
  statusCode: number;
  message: string;
  code: string;
} {
  if (error instanceof DatabaseError) {
    return { statusCode: error.statusCode, message: error.message, code: error.code };
  }

  const pgCode = (error as any)?.code;

  if (pgCode === POSTGRES_UNIQUE_VIOLATION) {
    return {
      statusCode: 409,
      message: 'A record with the same unique identifier already exists.',
      code: 'UNIQUE_VIOLATION',
    };
  }

  if (pgCode === POSTGRES_FK_VIOLATION) {
    return {
      statusCode: 409,
      message: 'This operation violates a clinical record relationship and was blocked to preserve data integrity.',
      code: 'FOREIGN_KEY_VIOLATION',
    };
  }

  if (pgCode === POSTGRES_CHECK_VIOLATION) {
    return {
      statusCode: 400,
      message: 'The supplied values failed a database validation constraint.',
      code: 'CHECK_VIOLATION',
    };
  }

  if (pgCode === 'ECONNREFUSED' || pgCode === 'ENOTFOUND' || pgCode === 'ETIMEDOUT') {
    return {
      statusCode: 503,
      message: 'Unable to reach the database. Please retry once connectivity is restored.',
      code: 'DATABASE_UNREACHABLE',
    };
  }

  const message = error instanceof Error ? error.message : String(error);

  // Repository-level storage failures are server errors. Do not echo database
  // internals (SQL / PostgREST text) back to the client.
  if (/^Database error|^Failed to |^PostgreSQL/i.test(message)) {
    return { statusCode: 500, message: fallbackMessage, code: 'REPOSITORY_ERROR' };
  }

  if (/^Invalid |^Payment amount|^receipt_number/i.test(message)) {
    return { statusCode: 400, message, code: 'INVALID_DATA' };
  }

  return { statusCode: 500, message: fallbackMessage, code: 'INTERNAL_ERROR' };
}

/**
 * Wraps a repository call so repositories can raise typed errors from
 * Supabase `error` objects without repeating message formatting.
 */
export function repositoryError(operation: string, error: { message?: string } | null | undefined): never {
  throw new DatabaseError(`${operation}: ${error?.message || 'unknown database failure'}`);
}
