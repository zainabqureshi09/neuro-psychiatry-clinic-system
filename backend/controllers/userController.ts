import { Request, Response, NextFunction } from 'express';
import { IUserPermissions, UserRole } from '../../models/User';
import { recordAuditEvent } from '../utils/auditLogger';
import {
  listUsers,
  findUserByEmail,
  findUserById,
  countUsers,
  createUser as createUserRecord,
  updateUser as updateUserRecord,
} from '../../lib/db/repositories/userRepository';
import { toPublicUser } from './authController';

const getDefaultPermissionsForRole = (role: UserRole): IUserPermissions => {
  switch (role) {
    case 'ADMIN':
      return {
        canWriteClinicalNotes: true,
        canPrescribe: true,
        canManagePatients: true,
        canManageAppointments: true,
        canManageUsers: true,
        canViewReports: true,
      };
    case 'DOCTOR':
      return {
        canWriteClinicalNotes: true,
        canPrescribe: true,
        canManagePatients: true,
        canManageAppointments: true,
        canManageUsers: false,
        canViewReports: true,
      };
    case 'THERAPIST':
      return {
        canWriteClinicalNotes: true,
        canPrescribe: false,
        canManagePatients: true,
        canManageAppointments: true,
        canManageUsers: false,
        canViewReports: false,
      };
    case 'RECEPTION':
    case 'RECEPTIONIST':
    default:
      return {
        canWriteClinicalNotes: false,
        canPrescribe: false,
        canManagePatients: true,
        canManageAppointments: true,
        canManageUsers: false,
        canViewReports: false,
      };
  }
};

/**
 * GET /api/users
 * Admin-only listing of all staff user accounts.
 */
export const getUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const page = Math.max(1, parseInt((req.query.page || '1').toString(), 10));
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit || '50').toString(), 10)));

    const users = await listUsers();
    // Newest accounts first (repository returns ascending creation order)
    const ordered = [...users].reverse();
    const total = ordered.length;
    const paged = ordered.slice((page - 1) * limit, (page - 1) * limit + limit);

    res.status(200).json({
      success: true,
      count: paged.length,
      total,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        total,
      },
      data: paged.map(toPublicUser),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/users
 * Admin-only user creation for staff members (ADMIN, DOCTOR, RECEPTION, THERAPIST).
 */
export const createUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, password, role, phone, title, department } = req.body;
    const adminUser = req.user;

    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      res.status(409).json({
        success: false,
        error: 'A user account with this email already exists.',
      });
      return;
    }

    const count = await countUsers();
    const userId = `USR-${String(count + 1).padStart(3, '0')}`;
    const permissions = getDefaultPermissionsForRole(role as UserRole);

    const newUser = await createUserRecord({
      userId,
      name: String(name).trim(),
      email: String(email),
      password: String(password),
      role: role as UserRole,
      phone: phone ? String(phone).trim() : '',
      title: title ? String(title).trim() : '',
      department: department ? String(department).trim() : '',
      permissions,
    });

    await recordAuditEvent({
      userId: adminUser?.userId || 'USR-ADMIN',
      userName: adminUser?.name || 'Administrator',
      userRole: adminUser?.role || 'ADMIN',
      action: 'CREATE',
      module: 'USERS',
      resourceId: newUser.userId,
      description: `Created staff user account ${newUser.userId} (${newUser.name}, role: ${newUser.role})`,
    });

    const publicUser = toPublicUser(newUser);

    res.status(201).json({
      success: true,
      message: `Staff user account ${newUser.userId} created successfully.`,
      user: publicUser,
      data: publicUser,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/users/:id
 * Admin-only update of staff account role, profile fields and permissions.
 */
export const updateUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);
    const adminUser = req.user;

    const targetUser = await findUserById(id);

    if (!targetUser) {
      res.status(404).json({
        success: false,
        error: `User account not found for ID: ${id}`,
      });
      return;
    }

    const { name, role, phone, title, department, isActive, permissions } = req.body;

    const updates: Record<string, any> = {};

    if (name) updates.name = String(name).trim();
    if (phone !== undefined) updates.phone = String(phone).trim();
    if (title !== undefined) updates.title = String(title).trim();
    if (department !== undefined) updates.department = String(department).trim();
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    if (role && ['ADMIN', 'DOCTOR', 'RECEPTION', 'RECEPTIONIST', 'THERAPIST'].includes(role)) {
      updates.role = role as UserRole;
      updates.permissions = permissions || getDefaultPermissionsForRole(role as UserRole);
    } else if (permissions) {
      updates.permissions = { ...targetUser.permissions, ...permissions };
    }

    const updated = (await updateUserRecord(targetUser.userId, updates)) || { ...targetUser, ...updates };

    // Log server-side audit event for user update
    await recordAuditEvent({
      userId: adminUser?.userId || 'USR-ADMIN',
      userName: adminUser?.name || 'Administrator',
      userRole: adminUser?.role || 'ADMIN',
      action: 'UPDATE',
      module: 'USERS',
      resourceId: updated.userId,
      description: `Updated staff user account ${updated.userId} (${updated.name}, role: ${updated.role})`,
    });

    const publicUser = toPublicUser(updated);

    res.status(200).json({
      success: true,
      message: `User account ${updated.userId} updated successfully.`,
      user: publicUser,
      data: publicUser,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/users/:id
 * Admin-only deactivation of staff user account.
 */
export const deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);
    const adminUser = req.user;

    const targetUser = await findUserById(id);

    if (!targetUser) {
      res.status(404).json({
        success: false,
        error: `User account not found for ID: ${id}`,
      });
      return;
    }

    if (targetUser.userId === adminUser?.userId) {
      res.status(400).json({
        success: false,
        error: 'Administrators cannot deactivate their own active account.',
      });
      return;
    }

    await updateUserRecord(targetUser.userId, { isActive: false });

    // Log server-side audit event for user deactivation
    await recordAuditEvent({
      userId: adminUser?.userId || 'USR-ADMIN',
      userName: adminUser?.name || 'Administrator',
      userRole: adminUser?.role || 'ADMIN',
      action: 'DELETE',
      module: 'USERS',
      resourceId: targetUser.userId,
      description: `Deactivated staff user account ${targetUser.userId} (${targetUser.name})`,
    });

    res.status(200).json({
      success: true,
      message: `User account ${targetUser.userId} deactivated successfully.`,
    });
  } catch (error) {
    next(error);
  }
};
