import { NextResponse } from 'next/server';
import { ConsultationSchema } from '@/lib/validators';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { listConsultations } from '@/lib/db/repositories/consultationRepository';
import { createConsultationCascade } from '@/lib/db/repositories/consultationCascade';
import { getPatientById } from '@/lib/db/repositories/patientRepository';
import { getClinicSettings } from '@/lib/db/repositories/settingsRepository';
import { auditFromSession } from '@/lib/audit';

const RESTRICTED = '[Restricted: Clinical Note Access Limited for Reception]';

// Helper to sanitize clinical notes for Reception role
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

function formatConsultation(consultation: any) {
  return {
    ...consultation,
    id: consultation.consultationId,
    date: consultation.consultationDate,
  };
}

// GET /api/patients/[patientId]/consultations
export async function GET(
  req: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'RECEPTION', 'ADMIN', 'THERAPIST'], req);
    if (!auth.authorized) return auth.response!;

    const { patientId } = await params;
    await ensureDatabaseReady();

    const patient = await getPatientById(patientId);

    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient record not found for ID: ${patientId}` },
        { status: 404 }
      );
    }

    const consultations = await listConsultations({ patientId: patient.patientId });
    const isReception = auth.session?.role === 'RECEPTION' || auth.session?.role === 'RECEPTIONIST';

    const formatted = consultations.map((c) => {
      const item = formatConsultation(c);
      return isReception ? sanitizeForReception(item) : item;
    });

    return NextResponse.json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error: any) {
    console.error('Error fetching patient consultations:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching patient consultation records.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/patients/[patientId]/consultations
export async function POST(
  req: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { patientId } = await params;
    await ensureDatabaseReady();
    const body = await req.json();

    body.patientId = patientId;
    if (body.date && !body.consultationDate) body.consultationDate = body.date;

    const validation = ConsultationSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const consultData = validation.data;

    const patient = await getPatientById(patientId);

    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient record not found for ID: ${patientId}` },
        { status: 404 }
      );
    }

    const doctorId = auth.session?.userId || consultData.doctorId || 'USR-001';
    const doctorName = auth.session?.name || consultData.doctorName || 'DR SHAHAB MUHAMMAD';
    const settings = await getClinicSettings();

    const result = await createConsultationCascade({
      consultation: {
        ...consultData,
        patientId: patient.patientId,
        patientName: patient.fullName,
        doctorId,
        doctorName,
        clinicianId: doctorId,
        clinicianName: doctorName,
      },
      patient: {
        patientId: patient.patientId,
        fullName: patient.fullName,
        age: patient.age,
        gender: patient.gender,
        phone: patient.phone,
      },
      doctorLicense: settings.licenseNumber,
      actorId: auth.session?.userId || 'SYSTEM',
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'CONSULTATIONS',
      resourceType: 'CONSULTATION',
      resourceId: result.consultation.consultationId,
      patientRef: patient.patientId,
      description: `Created consultation ${result.consultation.consultationId} for ${patient.fullName}`,
      metadata: {
        prescriptionId: result.prescription?.prescriptionId,
        followUpId: result.followUp?.followUpId,
        transactional: result.transactional,
      },
    });

    return NextResponse.json(
      {
        success: true,
        data: formatConsultation(result.consultation),
        message: `Clinical consultation record saved for ${patient.fullName}`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error saving consultation:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error saving consultation record.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
