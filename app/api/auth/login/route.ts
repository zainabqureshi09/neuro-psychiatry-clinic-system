import { NextResponse } from 'next/server';
import { verifyPassword, createSessionCookie } from '@/lib/auth';
import { LoginSchema } from '@/lib/validators';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { findUserByEmail, updateUser } from '@/lib/db/repositories/userRepository';
import { recordAuditEvent } from '@/lib/db/repositories/auditRepository';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const validation = LoginSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const { email, password } = validation.data;

    await ensureDatabaseReady();

    // Find user by email (PostgreSQL first, preserved MongoDB fallback)
    const user = await findUserByEmail(email);

    if (!user) {
      await recordAuditEvent({
        userId: 'ANONYMOUS',
        userName: 'Unknown User',
        userRole: 'GUEST',
        action: 'LOGIN_FAILED',
        module: 'AUTH',
        description: `Failed login attempt for non-existent email: ${email}`,
      });
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      await recordAuditEvent({
        userId: user.userId,
        userName: user.name,
        userRole: user.role,
        action: 'LOGIN_BLOCKED',
        module: 'AUTH',
        description: `Blocked login attempt for deactivated account ${user.userId} (${email})`,
      });
      return NextResponse.json(
        { success: false, error: 'User account is deactivated. Contact practice admin.' },
        { status: 403 }
      );
    }

    // Verify bcrypt password against the stored hash
    const isPasswordValid = await verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      await recordAuditEvent({
        userId: user.userId,
        userName: user.name,
        userRole: user.role,
        action: 'LOGIN_FAILED',
        module: 'AUTH',
        description: `Failed login attempt (invalid password) for user ${user.userId} (${email})`,
      });
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Update lastActive timestamp without blocking the session on failure
    try {
      await updateUser(user.userId, { lastActive: 'Just now' });
    } catch (updateError: any) {
      console.error('[Auth] Unable to update lastActive:', updateError?.message || updateError);
    }

    // Custom JWT signed into an HTTP-only cookie (unchanged contract)
    await createSessionCookie({
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    await recordAuditEvent({
      userId: user.userId,
      userName: user.name,
      userRole: user.role,
      action: 'LOGIN',
      module: 'AUTH',
      description: `User ${user.name} (${user.userId}) logged in successfully.`,
    });

    const userResponse = {
      id: user.userId,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      title: user.title,
      department: user.department,
      status: user.isActive ? 'ACTIVE' : 'INACTIVE',
      lastActive: 'Just now',
      permissions: user.permissions,
    };

    return NextResponse.json({
      success: true,
      data: userResponse,
      message: `Welcome back, ${user.name}`,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'An unexpected authentication error occurred.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
