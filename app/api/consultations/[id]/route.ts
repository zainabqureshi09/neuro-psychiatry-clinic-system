import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  getConsultationById,
  updateConsultation,
} from '@/lib/db/repositories/consultationRepository';
import { auditFromSession } from '@/lib/audit';

// GET /api/consultations/[id]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { id } = await params;
    await ensureDatabaseReady();

    const consultation = await getConsultationById(id);

    if (!consultation) {
      return NextResponse.json(
        { success: false, error: 'Consultation record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...consultation,
        id: consultation.consultationId,
        date: consultation.consultationDate,
      },
    });
  } catch (error: any) {
    console.error('Error fetching consultation:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to fetch consultation details.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// PUT /api/consultations/[id]
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR'], req);
    if (!auth.authorized) return auth.response!;

    const { id } = await params;
    await ensureDatabaseReady();
    const body = await req.json();

    // Identifiers are immutable; only clinical content may change.
    delete body.id;
    delete body._id;
    delete body.consultationId;
    delete body.patientId;
    delete body.createdAt;

    const consultation = await updateConsultation(id, body);

    if (!consultation) {
      return NextResponse.json(
        { success: false, error: 'Consultation record not found' },
        { status: 404 }
      );
    }

    await auditFromSession(auth.session, {
      action: 'UPDATE',
      module: 'CONSULTATIONS',
      resourceType: 'CONSULTATION',
      resourceId: consultation.consultationId,
      patientRef: consultation.patientId,
      description: `Updated consultation ${consultation.consultationId}`,
    });

    return NextResponse.json({
      success: true,
      data: {
        ...consultation,
        id: consultation.consultationId,
        date: consultation.consultationDate,
      },
      message: 'Consultation record updated successfully.',
    });
  } catch (error: any) {
    console.error('Error updating consultation:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to update consultation record.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
