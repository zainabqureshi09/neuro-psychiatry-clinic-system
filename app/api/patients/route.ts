import { NextResponse } from 'next/server';
import dbConnect from '@/lib/dbConnect';
import { PatientSchema } from '@/lib/validators';
import { authorizeUser } from '@/lib/permissions';
import { listPatients, createPatient } from '@/lib/db/repositories/patientRepository';

// GET /api/patients - Search & list paginated patients
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN']);
    if (!auth.authorized) return auth.response!;

    await dbConnect();
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
    return NextResponse.json(
      { success: false, error: 'Database error fetching patient records.' },
      { status: 500 }
    );
  }
}

// POST /api/patients - Register new patient
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN']);
    if (!auth.authorized) return auth.response!;

    await dbConnect();
    const body = await req.json();

    const validation = PatientSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const patientData = validation.data;
    const newPatient = await createPatient(patientData, auth.user?.userId || 'SYSTEM');

    return NextResponse.json({
      success: true,
      data: newPatient,
      message: `Patient ${newPatient.fullName} registered successfully with ID ${newPatient.patientId}`,
    });
  } catch (error: any) {
    console.error('Error creating patient:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create patient record in database.' },
      { status: 500 }
    );
  }
}

