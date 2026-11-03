import { SessionPayload } from '@/lib/auth';
import { recordAuditEvent, AuditLogRecord } from '@/lib/db/repositories/auditRepository';

/**
 * Server-side audit helper shared by Next.js route handlers.
 * Mirrors backend/utils/auditLogger.ts semantics:
 *  - never blocks or fails the user-facing operation
 *  - never records passwords, tokens, or secrets
 */

const SENSITIVE_KEYS = [
  'password',
  'passwordhash',
  'token',
  'jwt',
  'secret',
  'credentials',
  'authorization',
  'cookie',
  'session',
];

export function sanitizeAuditMetadata(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeAuditMetadata);

  const sanitized: Record<string, any> = {};
  for (const [key, entry] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((sensitive) => lowerKey.includes(sensitive))) continue;
    sanitized[key] = typeof entry === 'object' && entry !== null ? sanitizeAuditMetadata(entry) : entry;
  }
  return sanitized;
}

export interface AuditEventInput {
  action: string;
  module: string;
  description: string;
  resourceType?: string;
  resourceId?: string;
  patientRef?: string;
  metadata?: Record<string, any>;
}

/**
 * Records an audit event derived from the authenticated session.
 * Errors are swallowed so audit storage can never break clinical workflows.
 */
export async function auditFromSession(
  session: SessionPayload | undefined | null,
  event: AuditEventInput
): Promise<AuditLogRecord | null> {
  try {
    return await recordAuditEvent({
      userId: session?.userId || 'SYSTEM',
      userName: session?.name || 'System Process',
      userRole: session?.role || 'SYSTEM',
      action: event.action,
      module: event.module,
      description: event.description,
      resourceType: event.resourceType,
      resourceId: event.resourceId,
      patientRef: event.patientRef,
      metadata: sanitizeAuditMetadata(event.metadata || {}),
    });
  } catch (error: any) {
    console.error('[Audit] Non-blocking audit error:', error?.message || error);
    return null;
  }
}

/**
 * Fire-and-forget audit logging for route handlers that must not await.
 */
export function auditFromSessionAsync(
  session: SessionPayload | undefined | null,
  event: AuditEventInput
): void {
  void auditFromSession(session, event);
}
