import { NextResponse } from 'next/server';
import { PrescriptionSchema } from '@/lib/validators';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { listPrescriptions, createPrescription } from '@/lib/db/repositories/prescriptionRepository';
import { getPatientById } from '@/lib/db/repositories/patientRepository';
import { getClinicSettings } from '@/lib/db/repositories/settingsRepository';
import { auditFromSession } from '@/lib/audit';

function formatPrescription(prescription: any) {
  return {
    ...prescription,
    id: prescription.prescriptionId,
    dateIssued: prescription.prescriptionDate,
    treatmentNotes: prescription.treatmentPlan || prescription.treatmentNotes,
  };
}

// GET /api/prescriptions
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const patientId = searchParams.get('patientId');

    const prescriptions = await listPrescriptions({
      patientId: patientId || undefined,
    });

    return NextResponse.json({
      success: true,
      data: prescriptions.map(formatPrescription),
    });
  } catch (error: any) {
    console.error('Error fetching prescriptions:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching prescriptions.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/prescriptions - Generate standalone prescription
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    if (body.dateIssued && !body.prescriptionDate) body.prescriptionDate = body.dateIssued;
    if (body.treatmentNotes && !body.treatmentPlan) body.treatmentPlan = body.treatmentNotes;

    const validation = PrescriptionSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const rxData = validation.data;

    // Validate Patient
    const patient = await getPatientById(rxData.patientId);
    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient ${rxData.patientId} not found.` },
        { status: 404 }
      );
    }

    const settings = await getClinicSettings();

    const created = await createPrescription({
      ...rxData,
      patientId: patient.patientId,
      patientName: patient.fullName,
      patientAge: patient.age,
      patientGender: patient.gender,
      doctorId: rxData.doctorId || auth.session?.userId || 'USR-001',
      doctorName: rxData.doctorName || auth.session?.name || 'DR SHAHAB MUHAMMAD',
      doctorLicense: rxData.doctorLicense || settings.licenseNumber || 'NY-MED-849201',
      prescriptionDate: rxData.prescriptionDate || rxData.dateIssued || new Date().toISOString().split('T')[0],
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'PRESCRIPTIONS',
      resourceType: 'PRESCRIPTION',
      resourceId: created.prescriptionId,
      patientRef: patient.patientId,
      description: `Issued prescription ${created.prescriptionId} for ${patient.fullName}`,
    });

    return NextResponse.json({
      success: true,
      data: formatPrescription(created),
      message: `Prescription ${created.prescriptionId} issued for ${patient.fullName}`,
    });
  } catch (error: any) {
    console.error('Error issuing prescription:', error);
    const { statusCode, message } = normalizeDatabaseError(error, 'Failed to issue prescription.');
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
