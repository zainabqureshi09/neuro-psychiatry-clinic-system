import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  getConsultationByIdForPatient,
  updateConsultation,
} from '@/lib/db/repositories/consultationRepository';
import { getPatientById } from '@/lib/db/repositories/patientRepository';
import { auditFromSession } from '@/lib/audit';

const RESTRICTED = '[Restricted: Clinical Note Access Limited for Reception]';

function sanitizeForReception(c: any) {
  return {
    ...c,
    presentingComplaint: RESTRICTED,
    clinicalObservations: RESTRICTED,
    treatmentPlan: RESTRICTED,
    notes: RESTRICTED,
    followUpNotes: RESTRICTED,
    mentalStatusExam: {
      appearance: '[Restricted]',
      behavior: '[Restricted]',
      speech: '[Restricted]',
      moodAndAffect: '[Restricted]',
      thoughtProcess: '[Restricted]',
      thoughtContent: '[Restricted]',
      perception: '[Restricted]',
      cognition: '[Restricted]',
      insightAndJudgment: '[Restricted]',
    },
  };
}

// GET /api/patients/[patientId]/consultations/[consultationId]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ patientId: string; consultationId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'RECEPTION', 'ADMIN', 'THERAPIST'], req);
    if (!auth.authorized) return auth.response!;

    const { patientId, consultationId } = await params;
    await ensureDatabaseReady();

    const patient = await getPatientById(patientId);

    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient record not found for ID: ${patientId}` },
        { status: 404 }
      );
    }

    const consultation = await getConsultationByIdForPatient(consultationId, patient.patientId);

    if (!consultation) {
      return NextResponse.json(
        { success: false, error: `Consultation record not found for ID: ${consultationId}` },
        { status: 404 }
      );
    }

    const formatted = {
      ...consultation,
      id: consultation.consultationId,
      date: consultation.consultationDate,
    };
    const isReception = auth.session?.role === 'RECEPTION' || auth.session?.role === 'RECEPTIONIST';

    return NextResponse.json({
      success: true,
      data: isReception ? sanitizeForReception(formatted) : formatted,
    });
  } catch (error: any) {
    console.error('Error fetching patient consultation:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to fetch consultation details.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// PUT /api/patients/[patientId]/consultations/[consultationId]
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ patientId: string; consultationId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { patientId, consultationId } = await params;
    await ensureDatabaseReady();
    const body = await req.json();

    const patient = await getPatientById(patientId);

    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient record not found for ID: ${patientId}` },
        { status: 404 }
      );
    }

    const existing = await getConsultationByIdForPatient(consultationId, patient.patientId);

    if (!existing) {
      return NextResponse.json(
        { success: false, error: `Consultation record not found for ID: ${consultationId}` },
        { status: 404 }
      );
    }

    // Identifiers are immutable.
    delete body.id;
    delete body._id;
    delete body.consultationId;
    delete body.patientId;

    const consultation = await updateConsultation(existing.consultationId, body);

    if (!consultation) {
      return NextResponse.json(
        { success: false, error: `Consultation record not found for ID: ${consultationId}` },
        { status: 404 }
      );
    }

    await auditFromSession(auth.session, {
      action: 'UPDATE',
      module: 'CONSULTATIONS',
      resourceType: 'CONSULTATION',
      resourceId: consultation.consultationId,
      patientRef: patient.patientId,
      description: `Updated consultation ${consultation.consultationId} for ${patient.fullName}`,
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
