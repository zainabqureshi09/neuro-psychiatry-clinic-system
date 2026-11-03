import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  getPatientById,
  updatePatient,
  softDeletePatient,
} from '@/lib/db/repositories/patientRepository';
import { listAppointments } from '@/lib/db/repositories/appointmentRepository';
import { listConsultations } from '@/lib/db/repositories/consultationRepository';
import { listPrescriptions } from '@/lib/db/repositories/prescriptionRepository';
import { listFollowUps } from '@/lib/db/repositories/followUpRepository';
import { auditFromSession } from '@/lib/audit';

// GET /api/patients/[patientId] - Get patient detail with related clinical history
export async function GET(
  req: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { patientId } = await params;
    await ensureDatabaseReady();

    const patient = await getPatientById(patientId);
    if (!patient) {
      return NextResponse.json(
        { success: false, error: 'Patient not found' },
        { status: 404 }
      );
    }

    // Fetch related records (all clinical history preserved)
    const [appointments, consultations, prescriptions, followUps] = await Promise.all([
      listAppointments({ patientId: patient.patientId }),
      listConsultations({ patientId: patient.patientId }),
      listPrescriptions({ patientId: patient.patientId }),
      listFollowUps({ patientId: patient.patientId }),
    ]);

    const formattedPatient = {
      ...patient,
      id: patient.patientId,
    };

    return NextResponse.json({
      success: true,
      data: {
        patient: formattedPatient,
        appointments: appointments.map((a) => ({ ...a, id: a.appointmentId })),
        consultations: consultations.map((c) => ({ ...c, id: c.consultationId })),
        prescriptions: prescriptions.map((p) => ({ ...p, id: p.prescriptionId })),
        followUps: followUps.map((f) => ({ ...f, id: f.followUpId })),
      },
    });
  } catch (error: any) {
    console.error('Error fetching patient profile:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching patient chart.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}


// PUT /api/patients/[patientId] - Edit patient record
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { patientId } = await params;
    await ensureDatabaseReady();
    const body = await req.json();

    const existing = await getPatientById(patientId);
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Patient not found' },
        { status: 404 }
      );
    }

    // Identifiers are immutable - strip them before persisting.
    delete body.id;
    delete body._id;
    delete body.patientId;
    delete body.createdAt;
    delete body.createdBy;

    const updates: Record<string, any> = {
      ...body,
      updatedBy: auth.session?.userId || 'STAFF',
    };

    // Deep-merge the clinical JSON columns instead of overwriting them.
    if (body.emergencyContact) {
      updates.emergencyContact = { ...(existing.emergencyContact || {}), ...body.emergencyContact };
    }
    if (body.clinicalIntake) {
      updates.clinicalIntake = { ...(existing.clinicalIntake || {}), ...body.clinicalIntake };
    }

    const updated = await updatePatient(existing.patientId, updates);

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Patient not found' },
        { status: 404 }
      );
    }

    await auditFromSession(auth.session, {
      action: 'UPDATE',
      module: 'PATIENTS',
      resourceType: 'PATIENT',
      resourceId: updated.patientId,
      patientRef: updated.patientId,
      description: `Updated chart details for patient ${updated.fullName} (${updated.patientId})`,
    });

    return NextResponse.json({
      success: true,
      data: { ...updated, id: updated.patientId },
      message: 'Patient updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating patient:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to update patient record.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// DELETE /api/patients/[patientId] - Soft delete (clinical & billing history preserved)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { patientId } = await params;
    await ensureDatabaseReady();

    // SOFT DELETION: deactivates the patient without deleting clinical records,
    // prescriptions, appointments, payments, or audit trails.
    const patient = await softDeletePatient(patientId, auth.session?.userId || 'ADMIN');

    if (!patient) {
      return NextResponse.json(
        { success: false, error: 'Patient not found' },
        { status: 404 }
      );
    }

    await auditFromSession(auth.session, {
      action: 'DELETE',
      module: 'PATIENTS',
      resourceType: 'PATIENT',
      resourceId: patient.patientId,
      patientRef: patient.patientId,
      description: `Soft-deleted (deactivated) patient ${patient.fullName} (${patient.patientId}); clinical and billing history preserved`,
    });

    return NextResponse.json({
      success: true,
      message: `Patient ${patient.fullName} (${patient.patientId}) deactivated successfully. All clinical and financial history preserved.`,
    });
  } catch (error: any) {
    console.error('Error deactivating patient:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to deactivate patient record.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
