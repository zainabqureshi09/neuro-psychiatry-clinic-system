import { NextResponse } from 'next/server';
import { FollowUpSchema } from '@/lib/validators';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  listFollowUps,
  createFollowUp,
  updateFollowUp,
  deriveFollowUpStatus,
} from '@/lib/db/repositories/followUpRepository';
import { getPatientById } from '@/lib/db/repositories/patientRepository';
import { auditFromSession } from '@/lib/audit';

function formatFollowUp(followUp: any) {
  return {
    ...followUp,
    id: followUp.followUpId,
    dueDate: followUp.followUpDate,
  };
}

// GET /api/follow-ups - List follow-ups with auto status calculation
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');
    const patientId = searchParams.get('patientId');

    const todayStr = new Date().toISOString().split('T')[0];
    const rawFollowUps = await listFollowUps();

    // Recalculate date-derived statuses and persist the changes
    const synced = await Promise.all(
      rawFollowUps.map(async (followUp) => {
        const derived = deriveFollowUpStatus(followUp.followUpDate, followUp.status, todayStr);

        if (derived !== followUp.status) {
          try {
            await updateFollowUp(followUp.followUpId, { status: derived });
          } catch (syncError: any) {
            console.error('[FollowUps] Unable to sync status:', syncError?.message || syncError);
          }
        }

        return formatFollowUp({ ...followUp, status: derived });
      })
    );

    let filtered = synced;

    if (patientId) {
      filtered = filtered.filter((f) => f.patientId === patientId);
    }

    if (statusParam && statusParam !== 'All') {
      const targetStatus = statusParam.toLowerCase();
      filtered = filtered.filter((f) => String(f.status).toLowerCase() === targetStatus);
    }

    return NextResponse.json({
      success: true,
      data: filtered,
    });
  } catch (error: any) {
    console.error('Error fetching follow-ups:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching follow-up tasks.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/follow-ups - Create follow-up entry
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    if (body.dueDate && !body.followUpDate) body.followUpDate = body.dueDate;

    const validation = FollowUpSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const flpData = validation.data;
    const patient = await getPatientById(flpData.patientId);
    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient ${flpData.patientId} not found.` },
        { status: 404 }
      );
    }

    const followUpDate = flpData.followUpDate || flpData.dueDate || new Date().toISOString().split('T')[0];
    const status = deriveFollowUpStatus(followUpDate, flpData.status);

    const created = await createFollowUp({
      ...flpData,
      patientId: patient.patientId,
      patientName: patient.fullName,
      phone: patient.phone,
      followUpDate,
      status,
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'FOLLOW_UPS',
      resourceType: 'FOLLOW_UP',
      resourceId: created.followUpId,
      patientRef: patient.patientId,
      description: `Created follow-up ${created.followUpId} for ${patient.fullName} due ${followUpDate}`,
    });

    return NextResponse.json({
      success: true,
      data: formatFollowUp(created),
      message: `Follow-up created for ${patient.fullName} due on ${followUpDate}`,
    });
  } catch (error: any) {
    console.error('Error creating follow-up:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to create follow-up task.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
