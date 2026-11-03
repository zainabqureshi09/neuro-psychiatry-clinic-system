import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { findUserById } from '@/lib/db/repositories/userRepository';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { success: false, error: 'Not authenticated' },
        { status: 401 }
      );
    }

    await ensureDatabaseReady();
    const user = await findUserById(session.userId);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User record not found' },
        { status: 404 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        { success: false, error: 'User account is deactivated. Contact practice admin.' },
        { status: 403 }
      );
    }

    const userResponse = {
      id: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      title: user.title,
      department: user.department,
      status: user.isActive ? 'ACTIVE' : 'INACTIVE',
      lastActive: user.lastActive,
      permissions: user.permissions,
    };

    return NextResponse.json({
      success: true,
      data: userResponse,
    });
  } catch (error: any) {
    console.error('Error loading current user:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to retrieve current user session'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
