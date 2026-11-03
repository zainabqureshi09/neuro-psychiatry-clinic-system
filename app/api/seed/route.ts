import { NextResponse } from 'next/server';
import { runSeed } from '@/lib/seed';
import { getDatabaseConfig } from '@/lib/db';

export async function POST() {
  const isProd = process.env.NODE_ENV === 'production';
  const allowProdSeed = process.env.ALLOW_PRODUCTION_SEED === 'true';

  if (isProd && !allowProdSeed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Forbidden: Automatic database seeding is disabled in production environments to protect live clinical data.',
      },
      { status: 403 }
    );
  }

  // Demo seeding still targets the preserved MongoDB implementation. PostgreSQL
  // demo fixtures belong to the data-migration phase and are intentionally not
  // executed here (no live data migration in Phase Three).
  const config = getDatabaseConfig();
  if (config.provider !== 'mongodb') {
    return NextResponse.json(
      {
        success: false,
        error:
          'Demo seeding is currently available for the MongoDB provider only. PostgreSQL seeding will be provided with the data migration phase.',
      },
      { status: 409 }
    );
  }

  try {
    const counts = await runSeed();
    return NextResponse.json({
      success: true,
      data: counts,
      message: 'Database seeded successfully with staff accounts, demo patients, appointments, consultations, prescriptions, follow-ups, and clinic settings.',
    });
  } catch (error: any) {
    console.error('Database seed error:', error);
    return NextResponse.json(
      { success: false, error: 'Database seeding failed: ' + (error.message || error) },
      { status: 500 }
    );
  }
}
