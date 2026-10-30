import { getSupabaseClient } from '../supabase';
import { mapTherapySessionFromPg } from '../mapper';
import TherapySession, { ITherapySessionDoc } from '@/models/TherapySession';

export interface TherapySessionRecord {
  id: string;
  _id?: any;
  sessionId: string;
  patientId: string;
  patientName: string;
  therapistId: string;
  therapistName: string;
  sessionDate: string;
  durationMinutes: number;
  sessionType: string;
  assessment?: string;
  counselling?: string;
  intervention?: string;
  progressNotes?: string;
  psychometrics?: string;
  lifestyleInterventions?: string;
  followUpPlan?: string;
  followUpDate?: string;
  responsibleClinician?: string;
  responsibleClinicianId?: string;
  status: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function generateSessionId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count } = await supabase.from('therapy_sessions').select('*', { count: 'exact', head: true });
    return `TS-${700 + (count || 0) + 1}`;
  }

  const count = await TherapySession.countDocuments();
  return `TS-${700 + count + 1}`;
}

export async function listTherapySessions(filter: {
  patientId?: string;
  therapistId?: string;
  status?: string;
} = {}): Promise<TherapySessionRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase.from('therapy_sessions').select('*');

    if (filter.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter.therapistId) query = query.eq('therapist_id', filter.therapistId);
    if (filter.status && filter.status !== 'All') query = query.eq('status', filter.status);

    query = query.order('session_date', { ascending: false });

    const { data, error } = await query;
    if (error) {
      throw new Error(`Database error querying therapy sessions: ${error.message}`);
    }
    return (data || []).map(mapTherapySessionFromPg);
  }

  // Fallback: MongoDB
  const mongoFilter: any = {};
  if (filter.patientId) mongoFilter.patientId = filter.patientId;
  if (filter.therapistId) mongoFilter.therapistId = filter.therapistId;
  if (filter.status && filter.status !== 'All') mongoFilter.status = filter.status;

  const docs = await TherapySession.find(mongoFilter).sort({ sessionDate: -1 }).lean();
  return docs.map((d: any) => ({
    ...d,
    id: d.sessionId || d._id?.toString(),
  }));
}

export async function getTherapySessionById(id: string): Promise<TherapySessionRecord | null> {
  if (!id) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('therapy_sessions').select('*');

    if (isUuid) {
      query = query.or(`session_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('session_id', id);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Database error fetching therapy session: ${error.message}`);
    }
    return mapTherapySessionFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const doc = await TherapySession.findOne({
    $or: [{ sessionId: id }, { _id: isValidObjectId ? id : null }],
  }).lean();

  if (!doc) return null;
  return {
    ...doc,
    id: (doc as any).sessionId || (doc as any)._id?.toString(),
  } as TherapySessionRecord;
}

export async function createTherapySession(data: Partial<TherapySessionRecord>): Promise<TherapySessionRecord> {
  const sessionId = data.sessionId || (await generateSessionId());

  const supabase = getSupabaseClient();
  if (supabase) {
    const insertRow = {
      session_id: sessionId,
      patient_id: data.patientId,
      patient_name: data.patientName,
      therapist_id: data.therapistId,
      therapist_name: data.therapistName,
      session_date: data.sessionDate || new Date().toISOString().split('T')[0],
      duration_minutes: data.durationMinutes || 50,
      session_type: data.sessionType || 'Individual Psychotherapy',
      assessment: data.assessment || '',
      counselling: data.counselling || '',
      intervention: data.intervention || '',
      progress_notes: data.progressNotes || '',
      psychometrics: data.psychometrics || '',
      lifestyle_interventions: data.lifestyleInterventions || '',
      follow_up_plan: data.followUpPlan || '',
      follow_up_date: data.followUpDate || '',
      responsible_clinician: data.responsibleClinician || '',
      responsible_clinician_id: data.responsibleClinicianId || '',
      status: data.status || 'Completed',
      created_by: data.createdBy || '',
      updated_by: data.updatedBy || '',
    };

    const { data: created, error } = await supabase
      .from('therapy_sessions')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create therapy session: ${error.message}`);
    }
    return mapTherapySessionFromPg(created);
  }

  // Fallback: MongoDB
  const newSession = new TherapySession({
    ...data,
    sessionId,
  });

  await newSession.save();
  const obj: any = newSession.toObject ? newSession.toObject() : newSession;
  return {
    ...obj,
    id: obj.sessionId || obj._id?.toString(),
  } as TherapySessionRecord;
}

export async function updateTherapySession(
  id: string,
  updates: Partial<TherapySessionRecord>
): Promise<TherapySessionRecord | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const updateRow: Record<string, any> = {};

    if (updates.sessionType !== undefined) updateRow.session_type = updates.sessionType;
    if (updates.durationMinutes !== undefined) updateRow.duration_minutes = updates.durationMinutes;
    if (updates.assessment !== undefined) updateRow.assessment = updates.assessment;
    if (updates.counselling !== undefined) updateRow.counselling = updates.counselling;
    if (updates.intervention !== undefined) updateRow.intervention = updates.intervention;
    if (updates.progressNotes !== undefined) updateRow.progress_notes = updates.progressNotes;
    if (updates.psychometrics !== undefined) updateRow.psychometrics = updates.psychometrics;
    if (updates.lifestyleInterventions !== undefined) updateRow.lifestyle_interventions = updates.lifestyleInterventions;
    if (updates.followUpPlan !== undefined) updateRow.follow_up_plan = updates.followUpPlan;
    if (updates.followUpDate !== undefined) updateRow.follow_up_date = updates.followUpDate;
    if (updates.status !== undefined) updateRow.status = updates.status;

    let query = supabase.from('therapy_sessions').update(updateRow);
    if (isUuid) {
      query = query.or(`session_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('session_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to update therapy session: ${error.message}`);
    }
    return mapTherapySessionFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const session = await TherapySession.findOne({
    $or: [{ sessionId: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!session) return null;
  Object.assign(session, updates);
  await session.save();

  const obj: any = session.toObject ? session.toObject() : session;
  return {
    ...obj,
    id: obj.sessionId || obj._id?.toString(),
  } as TherapySessionRecord;
}

export async function deleteTherapySession(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('therapy_sessions').delete();
    if (isUuid) {
      query = query.or(`session_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('session_id', id);
    }
    const { error } = await query;
    return !error;
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const result = await TherapySession.deleteOne({
    $or: [{ sessionId: id }, { _id: isValidObjectId ? id : null }],
  });
  return (result.deletedCount || 0) > 0;
}
