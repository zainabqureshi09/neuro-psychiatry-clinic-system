import { NextResponse } from 'next/server';
import { PatientSchema } from '@/lib/validators';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  listPatients,
  createPatient,
  findPatientConflict,
} from '@/lib/db/repositories/patientRepository';
import { auditFromSession } from '@/lib/audit';

// GET /api/patients - Search & list paginated patients
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || searchParams.get('search') || '';
    const gender = searchParams.get('gender') || 'All';
    const status = searchParams.get('status') || 'All';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const result = await listPatients({
      search: query,
      gender,
      status,
      page,
      limit,
    });

    return NextResponse.json({
      success: true,
      data: result.data,
      pagination: {
        total: result.total,
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit) || 1,
      },
    });
  } catch (error: any) {
    console.error('Error fetching patients:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching patient records.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/patients - Register new patient
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    const validation = PatientSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const patientData = validation.data;

    // Duplicate chart guard (phone / CNIC) - mirrors the Express controller
    const conflict = await findPatientConflict(patientData.phone, (patientData as any).cnic);
    if (conflict) {
      return NextResponse.json(
        {
          success: false,
          error: 'A patient chart with this phone number or CNIC already exists.',
        },
        { status: 400 }
      );
    }

    const newPatient = await createPatient(patientData, auth.session?.userId || 'SYSTEM');

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'PATIENTS',
      resourceType: 'PATIENT',
      resourceId: newPatient.patientId,
      patientRef: newPatient.patientId,
      description: `Registered new patient ${newPatient.fullName} (${newPatient.patientId})`,
    });

    return NextResponse.json({
      success: true,
      data: newPatient,
      message: `Patient ${newPatient.fullName} registered successfully with ID ${newPatient.patientId}`,
    });
  } catch (error: any) {
    console.error('Error creating patient:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to create patient record in database.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
