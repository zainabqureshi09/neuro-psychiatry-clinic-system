import { NextResponse } from 'next/server';
import { ClinicSettingsSchema } from '@/lib/validators';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { getClinicSettings, updateClinicSettings } from '@/lib/db/repositories/settingsRepository';
import { auditFromSession } from '@/lib/audit';

/** Adds the legacy alias fields the frontend consumes. */
function formatSettings(settings: any) {
  return {
    ...settings,
    clinicStart: settings.clinicStartTime,
    clinicEnd: settings.clinicEndTime,
    slotDurationMinutes: settings.appointmentDuration,
    breakStart: settings.breakStartTime,
    breakEnd: settings.breakEndTime,
  };
}

// GET /api/settings - Fetch practice configuration & operating hours
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const settings = await getClinicSettings();

    return NextResponse.json({
      success: true,
      data: formatSettings(settings),
    });
  } catch (error: any) {
    console.error('Error fetching settings:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching practice settings.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// PUT /api/settings - Update practice configuration
export async function PUT(req: Request) {
  try {
    const auth = await authorizeUser(['ADMIN', 'DOCTOR'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    if (body.clinicStart && !body.clinicStartTime) body.clinicStartTime = body.clinicStart;
    if (body.clinicEnd && !body.clinicEndTime) body.clinicEndTime = body.clinicEnd;
    if (body.slotDurationMinutes && !body.appointmentDuration) body.appointmentDuration = body.slotDurationMinutes;
    if (body.breakStart && !body.breakStartTime) body.breakStartTime = body.breakStart;
    if (body.breakEnd && !body.breakEndTime) body.breakEndTime = body.breakEnd;

    const validation = ClinicSettingsSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const settings = await updateClinicSettings(validation.data as any);

    await auditFromSession(auth.session, {
      action: 'UPDATE',
      module: 'SETTINGS',
      resourceType: 'CLINIC_SETTINGS',
      resourceId: '1',
      description: 'Updated clinic operating parameters and practice settings.',
    });

    return NextResponse.json({
      success: true,
      data: formatSettings(settings),
      message: 'Clinic operating parameters and settings updated.',
    });
  } catch (error: any) {
    console.error('Error updating settings:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to update practice settings.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
