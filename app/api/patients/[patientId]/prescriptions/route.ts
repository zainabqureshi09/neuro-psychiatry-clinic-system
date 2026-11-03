import { NextResponse } from 'next/server';
import { PrescriptionSchema } from '@/lib/validators';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { listPrescriptions, createPrescription } from '@/lib/db/repositories/prescriptionRepository';
import { getPatientById } from '@/lib/db/repositories/patientRepository';
import { getClinicSettings } from '@/lib/db/repositories/settingsRepository';
import { auditFromSession } from '@/lib/audit';

const RESTRICTED = '[Restricted: Clinical Note Access Limited for Reception]';

function sanitizeForReception(rx: any) {
  return {
    ...rx,
    treatmentNotes: RESTRICTED,
    treatmentPlan: RESTRICTED,
    instructions: RESTRICTED,
    medications: rx.medications?.map((m: any) => ({
      ...m,
      instructions: '[Restricted for Reception]',
    })),
  };
}

function formatPrescription(rx: any) {
  return {
    ...rx,
    id: rx.prescriptionId,
    dateIssued: rx.prescriptionDate || rx.dateIssued,
  };
}

// GET /api/patients/[patientId]/prescriptions
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

    const prescriptions = await listPrescriptions({ patientId: patient.patientId });
    const isReception = auth.session?.role === 'RECEPTION' || auth.session?.role === 'RECEPTIONIST';

    const formatted = prescriptions.map((r) => {
      const item = formatPrescription(r);
      return isReception ? sanitizeForReception(item) : item;
    });

    return NextResponse.json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error: any) {
    console.error('Error fetching patient prescriptions:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching prescription records.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/patients/[patientId]/prescriptions
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
    if (body.dateIssued && !body.prescriptionDate) body.prescriptionDate = body.dateIssued;

    const validation = PrescriptionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const rxData = validation.data;
    const patient = await getPatientById(patientId);

    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient record not found for ID: ${patientId}` },
        { status: 404 }
      );
    }

    const settings = await getClinicSettings();
    const doctorId = auth.session?.userId || rxData.doctorId || 'USR-001';
    const doctorName = auth.session?.name || rxData.doctorName || 'DR SHAHAB MUHAMMAD';
    const prescriptionDate =
      rxData.prescriptionDate || rxData.dateIssued || new Date().toISOString().split('T')[0];

    const created = await createPrescription({
      ...rxData,
      patientId: patient.patientId,
      patientName: patient.fullName,
      patientAge: patient.age,
      patientGender: patient.gender,
      doctorId,
      doctorName,
      clinicianId: doctorId,
      clinicianName: doctorName,
      doctorLicense: rxData.doctorLicense || settings.licenseNumber || 'NY-MED-849201',
      prescriptionDate,
      dateIssued: prescriptionDate,
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'PRESCRIPTIONS',
      resourceType: 'PRESCRIPTION',
      resourceId: created.prescriptionId,
      patientRef: patient.patientId,
      description: `Issued prescription ${created.prescriptionId} for ${patient.fullName}`,
    });

    return NextResponse.json(
      {
        success: true,
        data: formatPrescription(created),
        message: `Prescription ${created.prescriptionId} issued successfully for ${patient.fullName}`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error issuing prescription:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error creating prescription record.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
