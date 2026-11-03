import { getSupabaseClient } from '../supabase';
import { mapFollowUpFromPg } from '../mapper';
import FollowUp, { IFollowUp } from '@/models/FollowUp';

export interface FollowUpRecord {
  id: string;
  _id?: any;
  followUpId: string;
  patientId: string;
  patientName: string;
  phone?: string;
  doctorId?: string;
  assignedDoctor: string;
  consultationId?: string;
  lastConsultationDate?: string;
  followUpDate: string;
  reason: string;
  priority: 'Routine' | 'High' | 'Urgent';
  status: string;
  notes?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

/**
 * Derives the clinical follow-up status from the due date, preserving terminal
 * states. Shared by the Next.js routes and the Express controllers so both APIs
 * report identical statuses.
 */
export function deriveFollowUpStatus(
  followUpDate: string,
  currentStatus?: string,
  todayStr: string = new Date().toISOString().split('T')[0]
): string {
  if (currentStatus && /^completed$/i.test(currentStatus)) {
    return currentStatus;
  }
  if (!followUpDate || followUpDate === 'N/A') {
    return currentStatus || 'Upcoming';
  }
  if (followUpDate === todayStr) return 'Due';
  if (followUpDate < todayStr) return 'Overdue';
  return 'Upcoming';
}

export async function generateFollowUpId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count } = await supabase.from('follow_ups').select('*', { count: 'exact', head: true });
    return `FLP-${300 + (count || 0) + 1}`;
  }

  const count = await FollowUp.countDocuments();
  return `FLP-${300 + count + 1}`;
}

export async function listFollowUps(filter: {
  patientId?: string;
  status?: string;
  priority?: string;
} = {}): Promise<FollowUpRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase.from('follow_ups').select('*');

    if (filter.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter.status && filter.status !== 'All') query = query.eq('status', filter.status);
    if (filter.priority && filter.priority !== 'All') query = query.eq('priority', filter.priority);

    query = query.order('follow_up_date', { ascending: true });

    const { data, error } = await query;
    if (error) {
      throw new Error(`Database error querying follow-ups: ${error.message}`);
    }
    return (data || []).map(mapFollowUpFromPg);
  }

  // Fallback: MongoDB
  const mongoFilter: any = {};
  if (filter.patientId) mongoFilter.patientId = filter.patientId;
  if (filter.status && filter.status !== 'All') mongoFilter.status = filter.status;
  if (filter.priority && filter.priority !== 'All') mongoFilter.priority = filter.priority;

  const docs = await FollowUp.find(mongoFilter).sort({ followUpDate: 1 }).lean();
  return docs.map((d: any) => ({
    ...d,
    id: d.followUpId || d._id?.toString(),
  }));
}

export async function getFollowUpById(id: string): Promise<FollowUpRecord | null> {
  if (!id) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('follow_ups').select('*');

    if (isUuid) {
      query = query.or(`follow_up_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('follow_up_id', id);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Database error fetching follow-up: ${error.message}`);
    }
    return mapFollowUpFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const doc = await FollowUp.findOne({
    $or: [{ followUpId: id }, { _id: isValidObjectId ? id : null }],
  }).lean();

  if (!doc) return null;
  return {
    ...doc,
    id: (doc as any).followUpId || (doc as any)._id?.toString(),
  } as FollowUpRecord;
}

export async function createFollowUp(data: Partial<FollowUpRecord>): Promise<FollowUpRecord> {
  const followUpId = data.followUpId || (await generateFollowUpId());

  const supabase = getSupabaseClient();
  if (supabase) {
    const insertRow = {
      follow_up_id: followUpId,
      patient_id: data.patientId,
      patient_name: data.patientName,
      phone: data.phone || '',
      doctor_id: data.doctorId || '',
      assigned_doctor: data.assignedDoctor || 'Dr. Vance',
      consultation_id: data.consultationId || '',
      last_consultation_date: data.lastConsultationDate || 'N/A',
      follow_up_date: data.followUpDate,
      reason: data.reason || 'Routine follow-up',
      priority: data.priority || 'Routine',
      status: data.status || 'Upcoming',
      notes: data.notes || '',
    };

    const { data: created, error } = await supabase
      .from('follow_ups')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create follow-up: ${error.message}`);
    }
    return mapFollowUpFromPg(created);
  }

  // Fallback: MongoDB
  const newFollowUp = new FollowUp({
    ...data,
    followUpId,
  });

  await newFollowUp.save();
  const obj: any = newFollowUp.toObject ? newFollowUp.toObject() : newFollowUp;
  return {
    ...obj,
    id: obj.followUpId || obj._id?.toString(),
  } as FollowUpRecord;
}

export async function updateFollowUp(
  id: string,
  updates: Partial<FollowUpRecord>
): Promise<FollowUpRecord | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const updateRow: Record<string, any> = {};

    if (updates.followUpDate !== undefined) updateRow.follow_up_date = updates.followUpDate;
    if (updates.reason !== undefined) updateRow.reason = updates.reason;
    if (updates.priority !== undefined) updateRow.priority = updates.priority;
    if (updates.status !== undefined) updateRow.status = updates.status;
    if (updates.notes !== undefined) updateRow.notes = updates.notes;
    if (updates.assignedDoctor !== undefined) updateRow.assigned_doctor = updates.assignedDoctor;

    let query = supabase.from('follow_ups').update(updateRow);
    if (isUuid) {
      query = query.or(`follow_up_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('follow_up_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to update follow-up: ${error.message}`);
    }
    return mapFollowUpFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const followUp = await FollowUp.findOne({
    $or: [{ followUpId: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!followUp) return null;
  Object.assign(followUp, updates);
  await followUp.save();

  const obj: any = followUp.toObject ? followUp.toObject() : followUp;
  return {
    ...obj,
    id: obj.followUpId || obj._id?.toString(),
  } as FollowUpRecord;
}

export async function deleteFollowUp(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('follow_ups').delete();
    if (isUuid) {
      query = query.or(`follow_up_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('follow_up_id', id);
    }
    const { error } = await query;
    return !error;
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const result = await FollowUp.deleteOne({
    $or: [{ followUpId: id }, { _id: isValidObjectId ? id : null }],
  });
  return (result.deletedCount || 0) > 0;
}
