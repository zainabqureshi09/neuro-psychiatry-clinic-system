import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { listAuditLogs, recordAuditEvent } from '@/lib/db/repositories/auditRepository';
import { sanitizeAuditMetadata } from '@/lib/audit';

// GET /api/audit-logs - ADMIN-only endpoint to retrieve audit logs
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const moduleName = searchParams.get('module');
    const userRole = searchParams.get('role');
    const action = searchParams.get('action');
    const patientRef = searchParams.get('patientRef');

    const { data } = await listAuditLogs({
      module: moduleName && moduleName !== 'All' ? moduleName : undefined,
      userRole: userRole && userRole !== 'All' ? userRole : undefined,
      action: action && action !== 'All' ? action : undefined,
      patientRef: patientRef || undefined,
      page: 1,
      limit: 200,
    });

    const formatted = data.map((log) => ({
      ...log,
      id: log.logId,
    }));

    return NextResponse.json({ success: true, count: formatted.length, data: formatted });
  } catch (error: any) {
    console.error('Error fetching audit logs:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching audit logs.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/audit-logs - Authenticated endpoint to log audit events
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(undefined, req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    // Strip out top-level sensitive fields before persisting
    delete body.password;
    delete body.passwordHash;
    delete body.token;
    delete body.secret;
    delete body.credentials;

    const action = body.action || 'UNKNOWN';
    const moduleName = body.module || 'SYSTEM';

    let attempt = 0;
    let created = null;

    // Audit log IDs are sequential; retry on the rare unique-index collision.
    while (attempt < 3 && !created) {
      attempt += 1;
      created = await recordAuditEvent({
        userId: body.userId || auth.session?.userId || 'SYSTEM',
        userName: body.userName || auth.session?.name || 'System Process',
        userRole: body.userRole || auth.session?.role || 'SYSTEM',
        action,
        module: moduleName,
        resourceType: body.resourceType || moduleName || '',
        resourceId: body.resourceId || '',
        patientRef: body.patientRef || '',
        description: body.description || `${action} on ${moduleName}`,
        metadata: sanitizeAuditMetadata(body.metadata || {}),
      });
    }

    if (!created) {
      return NextResponse.json(
        { success: false, error: 'Unable to persist audit log entry.' },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: { ...created, id: created.logId },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error recording audit event:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to record audit event.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
