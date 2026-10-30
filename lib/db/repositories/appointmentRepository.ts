import { getSupabaseClient } from '../supabase';
import { withTransaction, getPostgresPool } from '../postgres';
import { mapAppointmentFromPg } from '../mapper';
import Appointment, { IAppointment } from '@/models/Appointment';
import Patient from '@/models/Patient';
import { updatePatient } from './patientRepository';

export interface AppointmentRecord {
  id: string;
  _id?: any;
  appointmentId: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  doctorId: string;
  doctorName: string;
  clinicianId: string;
  clinicianName: string;
  appointmentDate: string;
  appointmentTime: string;
  date?: string;
  time?: string;
  durationMinutes: number;
  appointmentType: string;
  type?: string;
  notes?: string;
  room?: string;
  consultationMode?: string;
  onlineSessionLink?: string;
  status: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export const timeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  const cleanStr = timeStr.trim();

  if (/^\d{1,2}:\d{2}$/.test(cleanStr)) {
    const [h, m] = cleanStr.split(':').map(Number);
    return h * 60 + m;
  }

  const match = cleanStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return 0;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();

  if (period === 'PM' && hours < 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  return hours * 60 + minutes;
};

export async function checkClinicianConflict(
  doctorId: string,
  appointmentDate: string,
  appointmentTime: string,
  durationMinutes: number = 45,
  excludeAppointmentId?: string
): Promise<boolean> {
  if (!doctorId || !appointmentDate || !appointmentTime) return false;

  const newStart = timeToMinutes(appointmentTime);
  const newEnd = newStart + durationMinutes;

  const supabase = getSupabaseClient();
  if (supabase) {
    const { data: existingAppts } = await supabase
      .from('appointments')
      .select('appointment_id,appointment_time,duration_minutes,status')
      .or(`doctor_id.eq.${doctorId},clinician_id.eq.${doctorId}`)
      .eq('appointment_date', appointmentDate)
      .not('status', 'in', '("Cancelled","CANCELLED")');

    for (const appt of existingAppts || []) {
      if (excludeAppointmentId && appt.appointment_id === excludeAppointmentId) continue;
      const apptStart = timeToMinutes(appt.appointment_time);
      const apptEnd = apptStart + (appt.duration_minutes || 45);
      if (newStart < apptEnd && apptStart < newEnd) {
        return true;
      }
    }
    return false;
  }

  // Fallback: MongoDB
  const existingAppts = await Appointment.find({
    $or: [{ doctorId }, { clinicianId: doctorId }],
    appointmentDate,
    status: { $nin: ['Cancelled', 'CANCELLED'] },
  });

  for (const appt of existingAppts) {
    if (excludeAppointmentId && (appt.appointmentId === excludeAppointmentId || appt._id.toString() === excludeAppointmentId)) {
      continue;
    }
    const apptStart = timeToMinutes(appt.appointmentTime);
    const apptEnd = apptStart + (appt.durationMinutes || 45);
    if (newStart < apptEnd && apptStart < newEnd) {
      return true;
    }
  }

  return false;
}

export async function generateAppointmentId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count } = await supabase.from('appointments').select('*', { count: 'exact', head: true });
    return `APT-${1000 + (count || 0) + 1}`;
  }

  const count = await Appointment.countDocuments();
  return `APT-${1000 + count + 1}`;
}

export async function listAppointments(filter: {
  patientId?: string;
  doctorId?: string;
  date?: string;
  status?: string;
  search?: string;
} = {}): Promise<AppointmentRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase.from('appointments').select('*');

    if (filter.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter.doctorId) query = query.or(`doctor_id.eq.${filter.doctorId},clinician_id.eq.${filter.doctorId}`);
    if (filter.date) query = query.eq('appointment_date', filter.date);
    if (filter.status && filter.status !== 'All') query = query.eq('status', filter.status);

    query = query.order('appointment_date', { ascending: false }).order('appointment_time', { ascending: true });

    const { data, error } = await query;
    if (error) {
      throw new Error(`Database error querying appointments: ${error.message}`);
    }
    return (data || []).map(mapAppointmentFromPg);
  }

  // Fallback: MongoDB
  const mongoFilter: any = {};
  if (filter.patientId) mongoFilter.patientId = filter.patientId;
  if (filter.doctorId) {
    mongoFilter.$or = [{ doctorId: filter.doctorId }, { clinicianId: filter.doctorId }];
  }
  if (filter.date) mongoFilter.appointmentDate = filter.date;
  if (filter.status && filter.status !== 'All') mongoFilter.status = filter.status;

  const docs = await Appointment.find(mongoFilter).sort({ appointmentDate: -1, appointmentTime: 1 }).lean();
  return docs.map((d: any) => ({
    ...d,
    id: d.appointmentId || d._id?.toString(),
    date: d.appointmentDate,
    time: d.appointmentTime,
    type: d.appointmentType,
  }));
}

export async function getAppointmentById(id: string): Promise<AppointmentRecord | null> {
  if (!id) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('appointments').select('*');

    if (isUuid) {
      query = query.or(`appointment_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('appointment_id', id);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Database error fetching appointment: ${error.message}`);
    }
    return mapAppointmentFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const doc = await Appointment.findOne({
    $or: [{ appointmentId: id }, { _id: isValidObjectId ? id : null }],
  }).lean();

  if (!doc) return null;
  return {
    ...doc,
    id: (doc as any).appointmentId || (doc as any)._id?.toString(),
    date: (doc as any).appointmentDate,
    time: (doc as any).appointmentTime,
    type: (doc as any).appointmentType,
  } as AppointmentRecord;
}

export async function createAppointment(data: Partial<AppointmentRecord>): Promise<AppointmentRecord> {
  const appointmentId = data.appointmentId || (await generateAppointmentId());
  const clinicianId = data.clinicianId || data.doctorId || 'USR-001';
  const clinicianName = data.clinicianName || data.doctorName || 'Doctor';
  const duration = data.durationMinutes || 45;

  // Use pg transaction if pool is available for atomic creation + patient follow-up sync
  const pool = getPostgresPool();
  if (pool) {
    return withTransaction(async (client) => {
      const insertSql = `
        INSERT INTO appointments (
          appointment_id, patient_id, patient_name, patient_phone,
          doctor_id, doctor_name, clinician_id, clinician_name,
          appointment_date, appointment_time, duration_minutes,
          appointment_type, notes, room, consultation_mode, online_session_link,
          status, created_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        ) RETURNING *;
      `;
      const values = [
        appointmentId,
        data.patientId,
        data.patientName,
        data.patientPhone || '',
        data.doctorId || clinicianId,
        data.doctorName || clinicianName,
        clinicianId,
        clinicianName,
        data.appointmentDate,
        data.appointmentTime,
        duration,
        data.appointmentType || data.type || 'Follow-up Consultation',
        data.notes || '',
        data.room || 'Consultation Suite 1',
        data.consultationMode || 'In-Person',
        data.onlineSessionLink || '',
        data.status || 'Scheduled',
        data.createdBy || '',
      ];

      const res = await client.query(insertSql, values);

      // Atomic update of patient next_follow_up_date
      if (data.patientId && data.appointmentDate) {
        await client.query(
          `UPDATE patients 
           SET next_follow_up_date = $1 
           WHERE patient_id = $2 
             AND (next_follow_up_date IS NULL OR next_follow_up_date = 'N/A' OR $1 > next_follow_up_date)`,
          [data.appointmentDate, data.patientId]
        );
      }

      return mapAppointmentFromPg(res.rows[0]);
    });
  }

  // Supabase client fallback
  const supabase = getSupabaseClient();
  if (supabase) {
    const insertRow = {
      appointment_id: appointmentId,
      patient_id: data.patientId,
      patient_name: data.patientName,
      patient_phone: data.patientPhone || '',
      doctor_id: data.doctorId || clinicianId,
      doctor_name: data.doctorName || clinicianName,
      clinician_id: clinicianId,
      clinician_name: clinicianName,
      appointment_date: data.appointmentDate,
      appointment_time: data.appointmentTime,
      duration_minutes: duration,
      appointment_type: data.appointmentType || data.type || 'Follow-up Consultation',
      notes: data.notes || '',
      room: data.room || 'Consultation Suite 1',
      consultation_mode: data.consultationMode || 'In-Person',
      online_session_link: data.onlineSessionLink || '',
      status: data.status || 'Scheduled',
      created_by: data.createdBy || '',
    };

    const { data: created, error } = await supabase
      .from('appointments')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create appointment: ${error.message}`);
    }

    if (data.patientId && data.appointmentDate) {
      await updatePatient(data.patientId, { nextFollowUpDate: data.appointmentDate });
    }

    return mapAppointmentFromPg(created);
  }

  // Fallback: MongoDB
  const newAppointment = new Appointment({
    ...data,
    appointmentId,
    doctorId: data.doctorId || clinicianId,
    doctorName: data.doctorName || clinicianName,
    clinicianId,
    clinicianName,
    durationMinutes: duration,
    appointmentType: data.appointmentType || data.type || 'Follow-up Consultation',
  });

  await newAppointment.save();

  if (data.patientId && data.appointmentDate) {
    const patient = await Patient.findOne({ patientId: data.patientId });
    if (patient && (!patient.nextFollowUpDate || patient.nextFollowUpDate === 'N/A' || data.appointmentDate > patient.nextFollowUpDate)) {
      patient.nextFollowUpDate = data.appointmentDate;
      await patient.save();
    }
  }

  const obj: any = newAppointment.toObject ? newAppointment.toObject() : newAppointment;
  return {
    ...obj,
    id: obj.appointmentId || obj._id?.toString(),
    date: obj.appointmentDate,
    time: obj.appointmentTime,
    type: obj.appointmentType,
  } as AppointmentRecord;
}

export async function updateAppointment(
  id: string,
  updates: Partial<AppointmentRecord>
): Promise<AppointmentRecord | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const updateRow: Record<string, any> = {};

    if (updates.appointmentDate !== undefined) updateRow.appointment_date = updates.appointmentDate;
    if (updates.appointmentTime !== undefined) updateRow.appointment_time = updates.appointmentTime;
    if (updates.durationMinutes !== undefined) updateRow.duration_minutes = updates.durationMinutes;
    if (updates.appointmentType !== undefined) updateRow.appointment_type = updates.appointmentType;
    if (updates.notes !== undefined) updateRow.notes = updates.notes;
    if (updates.room !== undefined) updateRow.room = updates.room;
    if (updates.consultationMode !== undefined) updateRow.consultation_mode = updates.consultationMode;
    if (updates.onlineSessionLink !== undefined) updateRow.online_session_link = updates.onlineSessionLink;
    if (updates.status !== undefined) updateRow.status = updates.status;
    if (updates.updatedBy !== undefined) updateRow.updated_by = updates.updatedBy;

    let query = supabase.from('appointments').update(updateRow);
    if (isUuid) {
      query = query.or(`appointment_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('appointment_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to update appointment: ${error.message}`);
    }
    return mapAppointmentFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const appt = await Appointment.findOne({
    $or: [{ appointmentId: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!appt) return null;
  Object.assign(appt, updates);
  if (updates.date && !updates.appointmentDate) appt.appointmentDate = updates.date;
  if (updates.time && !updates.appointmentTime) appt.appointmentTime = updates.time;
  if (updates.type && !updates.appointmentType) appt.appointmentType = updates.type;

  await appt.save();

  const obj: any = appt.toObject ? appt.toObject() : appt;
  return {
    ...obj,
    id: obj.appointmentId || obj._id?.toString(),
    date: obj.appointmentDate,
    time: obj.appointmentTime,
    type: obj.appointmentType,
  } as AppointmentRecord;
}

export async function deleteAppointment(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('appointments').delete();
    if (isUuid) {
      query = query.or(`appointment_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('appointment_id', id);
    }
    const { error } = await query;
    return !error;
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const result = await Appointment.deleteOne({
    $or: [{ appointmentId: id }, { _id: isValidObjectId ? id : null }],
  });
  return (result.deletedCount || 0) > 0;
}
