import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { getPayments, recordPayment } from '@/lib/db/repositories/billingRepository';
import { auditFromSession } from '@/lib/audit';

// GET /api/payments - Payment ledger
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'RECEPTION', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const patientId = searchParams.get('patientId');
    const date = searchParams.get('date');
    const month = searchParams.get('month');
    const status = searchParams.get('status');

    const payments = await getPayments({
      patientId: patientId || undefined,
      date: date || undefined,
      month: month || undefined,
      status: status || undefined,
    });

    const formatted = payments.map((p) => ({ ...p, id: p.paymentId }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (error: any) {
    console.error('Error fetching payments:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching payments.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/payments - Record a payment (immutable receipt number)
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['ADMIN', 'RECEPTIONIST', 'RECEPTION'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    const created = await recordPayment({
      ...body,
      receivedBy: body.receivedBy || auth.session?.name || '',
      createdBy: auth.session?.userId || 'SYSTEM',
      updatedBy: auth.session?.userId || 'SYSTEM',
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'BILLING',
      resourceType: 'PAYMENT',
      resourceId: created.paymentId,
      patientRef: created.patientId,
      description: `Recorded payment ${created.paymentId} (receipt ${created.receiptNumber}) for ${created.patientName} - ${created.amount}`,
      metadata: { amount: created.amount, paymentMethod: created.paymentMethod },
    });

    return NextResponse.json({
      success: true,
      data: { ...created, id: created.paymentId },
      message: 'Payment recorded successfully.',
    });
  } catch (error: any) {
    console.error('Error recording payment:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to record payment.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
