import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  listTherapySessions,
  createTherapySession,
} from '@/lib/db/repositories/therapyRepository';
import { auditFromSession } from '@/lib/audit';

// GET /api/therapy - List psychotherapy sessions
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'RECEPTION', 'ADMIN', 'THERAPIST'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const patientId = searchParams.get('patientId');
    const therapistId = searchParams.get('therapistId');

    const sessions = await listTherapySessions({
      patientId: patientId || undefined,
      therapistId: therapistId || undefined,
    });

    const formatted = sessions.map((s) => ({ ...s, id: s.sessionId }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (error: any) {
    console.error('Error fetching therapy sessions:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching therapy sessions.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/therapy - Document a psychotherapy session
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'ADMIN', 'THERAPIST'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    const created = await createTherapySession({
      ...body,
      sessionId: body.id || body.sessionId,
      therapistId: body.therapistId || auth.session?.userId || 'USR-001',
      therapistName: body.therapistName || auth.session?.name || 'Clinician',
      createdBy: auth.session?.userId || 'SYSTEM',
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'THERAPY',
      resourceType: 'THERAPY_SESSION',
      resourceId: created.sessionId,
      patientRef: created.patientId,
      description: `Documented therapy session ${created.sessionId} for ${created.patientName}`,
    });

    return NextResponse.json({
      success: true,
      data: { ...created, id: created.sessionId },
      message: 'Therapy session documentation saved.',
    });
  } catch (error: any) {
    console.error('Error creating therapy session:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to save therapy session documentation.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
