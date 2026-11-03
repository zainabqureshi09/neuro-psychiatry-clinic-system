import { NextResponse } from 'next/server';
import { UserSchema } from '@/lib/validators';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { listUsers, findUserByEmail, createUser } from '@/lib/db/repositories/userRepository';
import { auditFromSession } from '@/lib/audit';

/** Removes the password hash from any staff payload sent to the client. */
function toPublicUser(user: any) {
  return {
    id: user.userId,
    userId: user.userId,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone || '',
    avatar: user.avatar || '',
    title: user.title || '',
    department: user.department || '',
    permissions: user.permissions || {},
    status: user.isActive ? 'ACTIVE' : 'INACTIVE',
    isActive: user.isActive,
    lastActive: user.lastActive || 'Never',
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

// GET /api/users - List system staff members
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const users = await listUsers();

    return NextResponse.json({
      success: true,
      data: users.map(toPublicUser),
    });
  } catch (error: any) {
    console.error('Error fetching users:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching staff directory.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/users - Admin register new staff user
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['ADMIN', 'DOCTOR'], req); // Admin/Doctor access
    if (!auth.authorized) return auth.response!;

    const body = await req.json();

    const validation = UserSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const userData = validation.data;

    await ensureDatabaseReady();

    // Check if email already exists
    const existing = await findUserByEmail(userData.email);
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'User with this email already exists.' },
        { status: 400 }
      );
    }

    // Preserve the legacy permission matrix for the Next.js contract
    const permissions = {
      canWriteClinicalNotes: userData.role === 'DOCTOR',
      canPrescribe: userData.role === 'DOCTOR',
      canManagePatients: true,
      canManageAppointments: true,
      canManageUsers: userData.role === 'ADMIN',
      canViewReports: userData.role !== 'RECEPTIONIST',
    };

    const newUser = await createUser({
      name: userData.name,
      email: userData.email,
      password: userData.password || 'VancePractice2026!',
      role: userData.role,
      phone: userData.phone || '',
      avatar:
        userData.avatar ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      title:
        userData.title ||
        (userData.role === 'DOCTOR'
          ? 'Consultant Psychiatrist'
          : userData.role === 'RECEPTIONIST'
            ? 'Clinical Coordinator'
            : 'Practice Director'),
      department:
        userData.department ||
        (userData.role === 'DOCTOR' ? 'Neuropsychiatry' : 'Practice Administration'),
      permissions,
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'USERS',
      resourceType: 'USER',
      resourceId: newUser.userId,
      description: `Created staff user ${newUser.name} (${newUser.userId}) with role ${newUser.role}`,
    });

    return NextResponse.json({
      success: true,
      data: toPublicUser(newUser),
      message: `Staff user ${newUser.name} created with role ${newUser.role}`,
    });
  } catch (error: any) {
    console.error('Error creating user:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to create user account.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
