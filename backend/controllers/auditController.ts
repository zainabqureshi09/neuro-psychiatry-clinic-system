import { Request, Response, NextFunction } from 'express';
import { recordAuditEvent, sanitizeAuditData } from '../utils/auditLogger';
import { listAuditLogs, recordAuditEvent as persistAuditEvent } from '../../lib/db/repositories/auditRepository';

/**
 * GET /api/audit-logs
 * ADMIN-only endpoint to retrieve paginated, filtered audit logs.
 */
export const getAuditLogs = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const search = (req.query.search || req.query.q || '').toString().trim();
    const action = (req.query.action || '').toString().trim();
    const moduleName = (req.query.module || req.query.resourceType || '').toString().trim();
    const user = (req.query.user || req.query.userId || '').toString().trim();
    const startDate = (req.query.startDate || req.query.from || '').toString().trim();
    const endDate = (req.query.endDate || req.query.to || '').toString().trim();

    const page = Math.max(1, parseInt((req.query.page || '1').toString(), 10));
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit || '50').toString(), 10)));

    const result = await listAuditLogs({
      search: search || undefined,
      action: action && action !== 'All' ? action : undefined,
      module: moduleName && moduleName !== 'All' ? moduleName : undefined,
      userId: user && user !== 'All' ? user : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      page,
      limit,
    });

    res.status(200).json({
      success: true,
      count: result.data.length,
      total: result.total,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit) || 1,
        total: result.total,
      },
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/audit-logs
 * Authenticated endpoint to record an audit log event.
 */
export const createAuditLog = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const user = req.user;
    const body = req.body || {};

    const action = body.action || 'UNKNOWN';
    const moduleName = body.module || 'SYSTEM';
    const description = body.description || `${action} on ${moduleName}`;

    const logEntry = await persistAuditEvent({
      userId: body.userId || user?.userId || 'SYSTEM',
      userName: body.userName || user?.name || 'System Process',
      userRole: body.userRole || user?.role || 'SYSTEM',
      action,
      module: moduleName,
      resourceType: body.resourceType || moduleName,
      resourceId: body.resourceId || '',
      patientRef: body.patientRef || '',
      description,
      metadata: sanitizeAuditData(body.metadata || {}),
    });

    if (!logEntry) {
      res.status(500).json({ success: false, error: 'Failed to save audit log entry.' });
      return;
    }

    res.status(201).json({
      success: true,
      data: { ...logEntry, id: logEntry.logId },
    });
  } catch (error) {
    next(error);
  }
};
