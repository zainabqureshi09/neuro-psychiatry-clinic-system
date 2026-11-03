import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { listBackupLogs, recordBackupLog } from '@/lib/db/repositories/backupRepository';
import { auditFromSession } from '@/lib/audit';

// GET /api/backup - Backup archive history (ADMIN only)
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const backups = await listBackupLogs(100);

    const formatted = backups.map((b) => ({
      ...b,
      id: b.backupId,
    }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (error: any) {
    console.error('Error listing backups:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to load backup archive history.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/backup - Record a generated backup archive (ADMIN only)
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
    const fileName =
      body.fileName ||
      `clinic-backup-${dateStr}-${(body.type || 'full').toLowerCase().replace(/\s+/g, '')}.json`;
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    const created = await recordBackupLog({
      backupId: body.id,
      timestamp,
      fileName,
      fileSize: body.fileSize || '4.5 MB',
      type: body.type || 'Full System',
      status: 'Completed',
      createdByName: body.createdByName || auth.session?.name || 'Practice Director',
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'BACKUP',
      resourceType: 'BACKUP_ARCHIVE',
      resourceId: created.backupId,
      description: `Generated backup archive ${created.fileName} (${created.backupId})`,
    });

    return NextResponse.json({
      success: true,
      data: { ...created, id: created.backupId },
      message: 'System backup archive generated successfully.',
    });
  } catch (error: any) {
    console.error('Error recording backup:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to record backup archive.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
