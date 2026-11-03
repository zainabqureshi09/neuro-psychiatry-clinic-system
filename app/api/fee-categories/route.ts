import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  getFeeCategories,
  createFeeCategory,
  updateFeeCategory,
} from '@/lib/db/repositories/billingRepository';
import { auditFromSession } from '@/lib/audit';

// GET /api/fee-categories
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'RECEPTION', 'ADMIN', 'THERAPIST'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const categories = await getFeeCategories();

    const formatted = categories.map((c) => ({ ...c, id: c.categoryId }));

    return NextResponse.json({ success: true, data: formatted });
  } catch (error: any) {
    console.error('Error fetching fee categories:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching fee categories.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/fee-categories - ADMIN only
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    const created = await createFeeCategory({
      ...body,
      categoryId: body.id || body.categoryId,
      defaultFee: body.defaultFee ?? body.amount,
      createdBy: auth.session?.userId || 'SYSTEM',
      updatedBy: auth.session?.userId || 'SYSTEM',
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'BILLING',
      resourceType: 'FEE_CATEGORY',
      resourceId: created.categoryId,
      description: `Added fee category ${created.name} (${created.categoryId}) at ${created.defaultFee}`,
    });

    return NextResponse.json({
      success: true,
      data: { ...created, id: created.categoryId },
      message: 'Fee category added.',
    });
  } catch (error: any) {
    console.error('Error creating fee category:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to add fee category.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// PUT /api/fee-categories - ADMIN only
export async function PUT(req: Request) {
  try {
    const auth = await authorizeUser(['ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'A fee category id is required.' },
        { status: 400 }
      );
    }

    const updated = await updateFeeCategory(id, {
      ...updates,
      updatedBy: auth.session?.userId || 'SYSTEM',
    });

    if (updated) {
      await auditFromSession(auth.session, {
        action: 'UPDATE',
        module: 'BILLING',
        resourceType: 'FEE_CATEGORY',
        resourceId: updated.categoryId,
        description: `Updated fee category ${updated.name} (${updated.categoryId})`,
      });
    }

    return NextResponse.json({
      success: true,
      data: updated ? { ...updated, id: updated.categoryId } : null,
      message: 'Fee category updated.',
    });
  } catch (error: any) {
    console.error('Error updating fee category:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to update fee category.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
