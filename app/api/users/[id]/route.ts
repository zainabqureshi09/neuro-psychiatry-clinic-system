import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import { findUserById, updateUser } from '@/lib/db/repositories/userRepository';
import { auditFromSession } from '@/lib/audit';

// PUT /api/users/[id] - Update user role & permissions
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeUser(['ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { id } = await params;
    await ensureDatabaseReady();
    const body = await req.json();

    const user = await findUserById(id);

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Staff user not found' },
        { status: 404 }
      );
    }

    const updates: Record<string, any> = {};

    if (body.role) {
      updates.role = body.role;
      updates.permissions = {
        canWriteClinicalNotes: body.role === 'DOCTOR',
        canPrescribe: body.role === 'DOCTOR',
        canManagePatients: true,
        canManageAppointments: true,
        canManageUsers: body.role === 'ADMIN',
        canViewReports: body.role !== 'RECEPTIONIST',
      };
    }

    if (body.name) updates.name = body.name;
    if (body.phone !== undefined) updates.phone = body.phone;
    if (body.title !== undefined) updates.title = body.title;
    if (body.department !== undefined) updates.department = body.department;
    if (body.isActive !== undefined) updates.isActive = body.isActive;

    const updated = (await updateUser(user.userId, updates)) || user;

    await auditFromSession(auth.session, {
      action: 'UPDATE',
      module: 'USERS',
      resourceType: 'USER',
      resourceId: updated.userId,
      description: `Updated staff user ${updated.name} (${updated.userId}) - role: ${updated.role}, active: ${updated.isActive}`,
    });

    const formatted = {
      id: updated.userId,
      userId: updated.userId,
      name: updated.name,
      email: updated.email,
      role: updated.role,
      phone: updated.phone || '',
      avatar: updated.avatar || '',
      title: updated.title || '',
      department: updated.department || '',
      permissions: updated.permissions || {},
      status: updated.isActive ? 'ACTIVE' : 'INACTIVE',
      isActive: updated.isActive,
      lastActive: updated.lastActive || 'Never',
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };

    return NextResponse.json({
      success: true,
      data: formatted,
      message: `User ${updated.name} role updated to ${updated.role}`,
    });
  } catch (error: any) {
    console.error('Error updating user:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to update user role.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
