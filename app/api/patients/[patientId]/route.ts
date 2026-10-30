import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { getPatientById, updatePatient, softDeletePatient } from '@/lib/db/repositories/patientRepository';
import { listAppointments } from '@/lib/db/repositories/appointmentRepository';
import { listConsultations } from '@/lib/db/repositories/consultationRepository';
import { listPrescriptions } from '@/lib/db/repositories/prescriptionRepository';
import { listFollowUps } from '@/lib/db/repositories/followUpRepository';
import { authorizeUser } from '@/lib/permissions';

// GET /api/patients/[patientId] - Get patient detail with related clinical history
export async function GET(
  req: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN']);
    if (!auth.authorized) return auth.response!;

    const { patientId } = await params;
    const id = patientId;
    await dbConnect();

    const patient = await getPatientById(id);
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
        appointments: appointments.map(a => ({ ...a, id: a.appointmentId })),
        consultations: consultations.map(c => ({ ...c, id: c.consultationId })),
        prescriptions: prescriptions.map(p => ({ ...p, id: p.prescriptionId })),
        followUps: followUps.map(f => ({ ...f, id: f.followUpId })),
      },
    });
  } catch (error: any) {
    console.error('Error fetching patient profile:', error);
    return NextResponse.json(
      { success: false, error: 'Database error fetching patient chart.' },
      { status: 500 }
    );
  }
}

// PUT /api/patients/[patientId] - Edit patient record
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN']);
    if (!auth.authorized) return auth.response!;

    const { patientId } = await params;
    const id = patientId;
    await dbConnect();
    const body = await req.json();

    const updated = await updatePatient(id, {
      ...body,
      updatedBy: auth.user?.userId || 'STAFF',
    });

    if (!updated) {
      return NextResponse.json(
        { success: false, error: 'Patient not found' },
        { status: 404 }
      );
    }

    const formatted = {
      ...updated,
      id: updated.patientId,
    };

    return NextResponse.json({
      success: true,
      data: formatted,
      message: 'Patient updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating patient:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update patient record.' },
      { status: 500 }
    );
  }
}

// DELETE /api/patients/[patientId] - Soft delete patient record (preserves clinical & billing records)
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ patientId: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'ADMIN']);
    if (!auth.authorized) return auth.response!;

    const { patientId } = await params;
    const id = patientId;
    await dbConnect();

    // SOFT DELETION: deactivates patient without deleting clinical records, prescriptions, or billing history
    const patient = await softDeletePatient(id, auth.user?.userId || 'ADMIN');

    if (!patient) {
      return NextResponse.json(
        { success: false, error: 'Patient not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Patient ${patient.fullName} (${patient.patientId}) deactivated successfully. All clinical and financial history preserved.`,
    });
  } catch (error: any) {
    console.error('Error deactivating patient:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to deactivate patient record.' },
      { status: 500 }
    );
  }
}

