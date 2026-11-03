import { recordAuditEvent as persistAuditEvent } from '../../lib/db/repositories/auditRepository';
import { AuditLogRecord } from '../../lib/db/repositories/auditRepository';
import { logger } from './logger';

export interface LogAuditParams {
  preferredId?: string;
  userId: string;
  userName?: string;
  userRole?: string;
  action: string;
  module: string;
  resourceType?: string;
  resourceId?: string;
  patientRef?: string;
  description: string;
  metadata?: Record<string, any>;
}

/**
 * Sanitizes metadata objects to remove sensitive keys (passwords, tokens, credentials, secrets).
 */
export function sanitizeAuditData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeAuditData);

  const sanitized: Record<string, any> = {};
  const SENSITIVE_KEYS = ['password', 'passwordhash', 'token', 'jwt', 'secret', 'credentials', 'authorization', 'cookie', 'session'];

  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
      continue;
    }
    if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditData(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

/**
 * Records a system audit event through the shared repository layer
 * (PostgreSQL when configured, preserved MongoDB fallback otherwise).
 *
 * Never throws or blocks main request execution. `preferredId` is accepted for
 * backward compatibility; sequence IDs are allocated by the repository to avoid
 * unique collisions.
 */
export const recordAuditEvent = async (params: LogAuditParams): Promise<AuditLogRecord | null> => {
  try {
    const entry = await persistAuditEvent({
      userId: params.userId || 'SYSTEM',
      userName: params.userName || 'System Process',
      userRole: params.userRole || 'SYSTEM',
      action: params.action,
      module: params.module,
      resourceType: params.resourceType || params.module,
      resourceId: params.resourceId || '',
      patientRef: params.patientRef || '',
      description: params.description,
      metadata: sanitizeAuditData(params.metadata || {}),
    });

    if (!entry) {
      logger.error('[AUDIT] Unable to persist audit event:', params.description);
      return null;
    }

    logger.info(`[AUDIT] ${params.action} on ${params.module} by ${params.userId}: ${params.description}`);
    return entry;
  } catch (error: any) {
    logger.error('Failed to save audit log entry:', error.message || error);
    return null;
  }
};


