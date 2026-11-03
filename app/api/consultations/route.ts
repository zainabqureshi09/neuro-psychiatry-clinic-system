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

function formatConsultation(consultation: any) {
  return {
    ...consultation,
    id: consultation.consultationId,
    date: consultation.consultationDate,
  };
}

// GET /api/consultations
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const patientId = searchParams.get('patientId');

    const consultations = await listConsultations({
      patientId: patientId || undefined,
    });

    return NextResponse.json({
      success: true,
      data: consultations.map(formatConsultation),
    });
  } catch (error: any) {
    console.error('Error fetching consultations:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching consultation records.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/consultations - Submit clinical consultation entry
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR'], req); // Doctor only
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    if (body.date && !body.consultationDate) body.consultationDate = body.date;

    const validation = ConsultationSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const consultData = validation.data;

    // 1. Validate Patient
    const patient = await getPatientById(consultData.patientId);
    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient ${consultData.patientId} not found.` },
        { status: 404 }
      );
    }

    const settings = await getClinicSettings();

    // 2. Atomic cascade: consultation + prescription + follow-up + chart dates
    const result = await createConsultationCascade({
      consultation: {
        ...consultData,
        patientId: patient.patientId,
        patientName: patient.fullName,
        doctorId: consultData.doctorId || auth.session?.userId || 'USR-001',
        doctorName: consultData.doctorName || auth.session?.name || 'DR SHAHAB MUHAMMAD',
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

    return NextResponse.json({
      success: true,
      data: formatConsultation(result.consultation),
      message: `Clinical consultation record saved for ${patient.fullName}`,
    });
  } catch (error: any) {
    console.error('Error saving consultation:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error saving consultation.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
