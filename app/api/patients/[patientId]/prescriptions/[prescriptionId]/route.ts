import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  getPrescriptionById,
  updatePrescription,
} from '@/lib/db/repositories/prescriptionRepository';
import { getPatientById } from '@/lib/db/repositories/patientRepository';
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

// GET /api/patients/[patientId]/prescriptions/[prescriptionId]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ patientId: string; prescriptionId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'RECEPTION', 'ADMIN', 'THERAPIST'], req);
    if (!auth.authorized) return auth.response!;

    const { patientId, prescriptionId } = await params;
    await ensureDatabaseReady();

    const patient = await getPatientById(patientId);

    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient record not found for ID: ${patientId}` },
        { status: 404 }
      );
    }

    const rx = await getPrescriptionById(prescriptionId);

    if (!rx || rx.patientId !== patient.patientId) {
      return NextResponse.json(
        { success: false, error: `Prescription record not found for ID: ${prescriptionId}` },
        { status: 404 }
      );
    }

    const formatted = formatPrescription(rx);
    const isReception = auth.session?.role === 'RECEPTION' || auth.session?.role === 'RECEPTIONIST';

    return NextResponse.json({
      success: true,
      data: isReception ? sanitizeForReception(formatted) : formatted,
    });
  } catch (error: any) {
    console.error('Error fetching prescription:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to fetch prescription details.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// PUT /api/patients/[patientId]/prescriptions/[prescriptionId]
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ patientId: string; prescriptionId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { patientId, prescriptionId } = await params;
    await ensureDatabaseReady();
    const body = await req.json();

    const patient = await getPatientById(patientId);

    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Patient record not found for ID: ${patientId}` },
        { status: 404 }
      );
    }

    const existing = await getPrescriptionById(prescriptionId);

    if (!existing || existing.patientId !== patient.patientId) {
      return NextResponse.json(
        { success: false, error: `Prescription record not found for ID: ${prescriptionId}` },
        { status: 404 }
      );
    }

    // Identifiers are immutable.
    delete body.id;
    delete body._id;
    delete body.prescriptionId;
    delete body.patientId;

    const rx = await updatePrescription(existing.prescriptionId, body);

    if (!rx) {
      return NextResponse.json(
        { success: false, error: `Prescription record not found for ID: ${prescriptionId}` },
        { status: 404 }
      );
    }

    await auditFromSession(auth.session, {
      action: 'UPDATE',
      module: 'PRESCRIPTIONS',
      resourceType: 'PRESCRIPTION',
      resourceId: rx.prescriptionId,
      patientRef: patient.patientId,
      description: `Updated prescription ${rx.prescriptionId} for ${patient.fullName}`,
    });

    return NextResponse.json({
      success: true,
      data: formatPrescription(rx),
      message: 'Prescription record updated successfully.',
    });
  } catch (error: any) {
    console.error('Error updating prescription:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to update prescription record.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
