import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { updateFollowUp } from '@/lib/db/repositories/followUpRepository';
import { auditFromSession } from '@/lib/audit';

// PUT /api/follow-ups/[id] - Update status or follow-up note
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { id } = await params;
    await ensureDatabaseReady();
    const body = await req.json();

    const updates: Record<string, any> = {};
    if (body.status) updates.status = body.status;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.reason) updates.reason = body.reason;

    const followUp = await updateFollowUp(id, updates);

    if (!followUp) {
      return NextResponse.json(
        { success: false, error: 'Follow-up task not found' },
        { status: 404 }
      );
    }

    await auditFromSession(auth.session, {
      action: 'UPDATE',
      module: 'FOLLOW_UPS',
      resourceType: 'FOLLOW_UP',
      resourceId: followUp.followUpId,
      patientRef: followUp.patientId,
      description: `Updated follow-up ${followUp.followUpId} to ${followUp.status}`,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...followUp,
        id: followUp.followUpId,
        dueDate: followUp.followUpDate,
      },
      message: `Follow-up ${followUp.followUpId} updated to ${followUp.status}`,
    });
  } catch (error: any) {
    console.error('Error updating follow-up:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to update follow-up task.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
