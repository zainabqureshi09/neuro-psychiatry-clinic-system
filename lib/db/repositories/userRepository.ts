import { getSupabaseClient } from '../supabase';
import { mapUserFromPg } from '../mapper';
import User, { IUser, UserRole, IUserPermissions } from '@/models/User';
import bcrypt from 'bcryptjs';

export interface UserRecord {
  id: string;
  userId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  phone?: string;
  avatar?: string;
  title?: string;
  department?: string;
  permissions: IUserPermissions;
  isActive: boolean;
  lastActive: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  if (!email) return null;
  const cleanEmail = email.toLowerCase().trim();

  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .ilike('email', cleanEmail)
      .maybeSingle();

    if (error) {
      throw new Error(`Database error querying user by email: ${error.message}`);
    }
    return mapUserFromPg(data);
  }

  // Fallback: MongoDB
  const user = await User.findOne({ email: cleanEmail });
  if (!user) return null;

  return {
    id: user._id.toString(),
    userId: user.userId,
    name: user.name,
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
    phone: user.phone,
    avatar: user.avatar,
    title: user.title,
    department: user.department,
    permissions: user.permissions,
    isActive: user.isActive,
    lastActive: user.lastActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  if (!id) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('users').select('*');

    if (isUuid) {
      query = query.or(`user_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('user_id', id);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Database error querying user by ID: ${error.message}`);
    }
    return mapUserFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const user = await User.findOne({
    $or: [{ userId: id }, { _id: isValidObjectId ? id : null }],
  });
  if (!user) return null;

  return {
    id: user._id.toString(),
    userId: user.userId,
    name: user.name,
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
    phone: user.phone,
    avatar: user.avatar,
    title: user.title,
    department: user.department,
    permissions: user.permissions,
    isActive: user.isActive,
    lastActive: user.lastActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Counts staff accounts without loading them (used for first-boot bootstrap).
 */
export async function countUsers(): Promise<number> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
    if (error) {
      throw new Error(`Database error counting users: ${error.message}`);
    }
    return count || 0;
  }

  return User.countDocuments();
}

export async function listUsers(): Promise<UserRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase.from('users').select('*').order('created_at', { ascending: true });
    if (error) {
      throw new Error(`Database error listing users: ${error.message}`);
    }
    return (data || []).map(mapUserFromPg);
  }

  // Fallback: MongoDB
  const users = await User.find().sort({ createdAt: 1 });
  return users.map((u) => ({
    id: u._id.toString(),
    userId: u.userId,
    name: u.name,
    email: u.email,
    passwordHash: u.passwordHash,
    role: u.role,
    phone: u.phone,
    avatar: u.avatar,
    title: u.title,
    department: u.department,
    permissions: u.permissions,
    isActive: u.isActive,
    lastActive: u.lastActive,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }));
}

export async function createUser(data: {
  userId?: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  phone?: string;
  avatar?: string;
  title?: string;
  department?: string;
  permissions?: Partial<IUserPermissions>;
}): Promise<UserRecord> {
  const email = data.email.toLowerCase().trim();
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(data.password, salt);

  const defaultPermissions: IUserPermissions = {
    canWriteClinicalNotes: data.role === 'DOCTOR' || data.role === 'THERAPIST' || data.role === 'ADMIN',
    canPrescribe: data.role === 'DOCTOR' || data.role === 'ADMIN',
    canManagePatients: true,
    canManageAppointments: true,
    canManageUsers: data.role === 'ADMIN',
    canViewReports: data.role === 'ADMIN' || data.role === 'DOCTOR',
    ...data.permissions,
  };

  const supabase = getSupabaseClient();
  if (supabase) {
    let userId = data.userId;
    if (!userId) {
      const { count } = await supabase.from('users').select('*', { count: 'exact', head: true });
      userId = `USR-${String((count || 0) + 1).padStart(3, '0')}`;
    }

    const { data: created, error } = await supabase
      .from('users')
      .insert({
        user_id: userId,
        name: data.name,
        email,
        password_hash: passwordHash,
        role: data.role,
        phone: data.phone || '',
        avatar: data.avatar || '',
        title: data.title || '',
        department: data.department || '',
        permissions: defaultPermissions,
        is_active: true,
        last_active: 'Never',
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create user: ${error.message}`);
    }

    return mapUserFromPg(created);
  }

  // Fallback: MongoDB
  let userId = data.userId;
  if (!userId) {
    const count = await User.countDocuments();
    userId = `USR-${String(count + 1).padStart(3, '0')}`;
  }

  const user = new User({
    userId,
    name: data.name,
    email,
    passwordHash,
    role: data.role,
    phone: data.phone || '',
    avatar: data.avatar || '',
    title: data.title || '',
    department: data.department || '',
    permissions: defaultPermissions,
    isActive: true,
    lastActive: 'Never',
  });

  await user.save();
  return {
    id: user._id.toString(),
    userId: user.userId,
    name: user.name,
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
    phone: user.phone,
    avatar: user.avatar,
    title: user.title,
    department: user.department,
    permissions: user.permissions,
    isActive: user.isActive,
    lastActive: user.lastActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export async function updateUser(
  id: string,
  updates: Partial<Omit<UserRecord, 'id' | 'userId' | 'createdAt'>>
): Promise<UserRecord | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const updateRow: Record<string, any> = {};

    if (updates.name !== undefined) updateRow.name = updates.name;
    if (updates.email !== undefined) updateRow.email = updates.email.toLowerCase().trim();
    if (updates.role !== undefined) updateRow.role = updates.role;
    if (updates.phone !== undefined) updateRow.phone = updates.phone;
    if (updates.avatar !== undefined) updateRow.avatar = updates.avatar;
    if (updates.title !== undefined) updateRow.title = updates.title;
    if (updates.department !== undefined) updateRow.department = updates.department;
    if (updates.permissions !== undefined) updateRow.permissions = updates.permissions;
    if (updates.isActive !== undefined) updateRow.is_active = updates.isActive;
    if (updates.lastActive !== undefined) updateRow.last_active = updates.lastActive;
    if (updates.passwordHash !== undefined) updateRow.password_hash = updates.passwordHash;

    let query = supabase.from('users').update(updateRow);
    if (isUuid) {
      query = query.or(`user_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('user_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to update user: ${error.message}`);
    }
    return mapUserFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const user = await User.findOne({
    $or: [{ userId: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!user) return null;
  Object.assign(user, updates);
  await user.save();

  return {
    id: user._id.toString(),
    userId: user.userId,
    name: user.name,
    email: user.email,
    passwordHash: user.passwordHash,
    role: user.role,
    phone: user.phone,
    avatar: user.avatar,
    title: user.title,
    department: user.department,
    permissions: user.permissions,
    isActive: user.isActive,
    lastActive: user.lastActive,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
