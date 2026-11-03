import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { getPrescriptionById } from '@/lib/db/repositories/prescriptionRepository';

// GET /api/prescriptions/[id]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { id } = await params;
    await ensureDatabaseReady();

    const prescription = await getPrescriptionById(id);

    if (!prescription) {
      return NextResponse.json(
        { success: false, error: 'Prescription record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        ...prescription,
        id: prescription.prescriptionId,
        dateIssued: prescription.prescriptionDate,
        treatmentNotes: prescription.treatmentPlan || prescription.treatmentNotes,
      },
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
