import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { getPracticeReport } from '@/lib/db/repositories/reportRepository';

// GET /api/reports - Aggregation statistics for practice analytics
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const reportsData = await getPracticeReport();

    return NextResponse.json({
      success: true,
      data: reportsData,
    });
  } catch (error: any) {
    console.error('Error generating practice reports:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database aggregation error generating reports.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
