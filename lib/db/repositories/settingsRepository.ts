import { getSupabaseClient } from '../supabase';
import { mapClinicSettingsFromPg } from '../mapper';
import ClinicSettings, { IClinicSettings } from '@/models/ClinicSettings';

export interface ClinicSettingsRecord {
  id?: number;
  clinicName: string;
  department?: string;
  doctorDesignation?: string;
  education?: string;
  practiceName?: string;
  tagline?: string;
  doctorName: string;
  licenseNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
  workingDays: string[];
  clinicStartTime: string;
  clinicEndTime: string;
  appointmentDuration: number;
  breakStartTime?: string;
  breakEndTime?: string;
  notifyEmail?: boolean;
  notifySms?: boolean;
  autoRemind24h?: boolean;
  operatingHours?: string;
  consultationFee?: number;
  sessionDurationMinutes?: number;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function getClinicSettings(): Promise<ClinicSettingsRecord> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase.from('clinic_settings').select('*').eq('id', 1).maybeSingle();
    if (data) {
      return mapClinicSettingsFromPg(data);
    }
  }

  // Fallback: MongoDB
  let settings = await ClinicSettings.findOne().lean();
  if (!settings) {
    const created = new ClinicSettings();
    await created.save();
    settings = created.toObject ? created.toObject() : created;
  }

  return {
    ...settings,
    id: 1,
    clinicName: settings.clinicName || 'Neuro Psychiatry Clinic',
    doctorName: settings.doctorName || 'DR SHAHAB MUHAMMAD',
    workingDays: settings.workingDays || ['Monday', 'Wednesday', 'Friday'],
    clinicStartTime: settings.clinicStartTime || '18:00',
    clinicEndTime: settings.clinicEndTime || '20:00',
    appointmentDuration: settings.appointmentDuration || 45,
  } as ClinicSettingsRecord;
}

export async function updateClinicSettings(updates: Partial<ClinicSettingsRecord>): Promise<ClinicSettingsRecord> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const updateRow: Record<string, any> = {};

    if (updates.clinicName !== undefined) updateRow.clinic_name = updates.clinicName;
    if (updates.department !== undefined) updateRow.department = updates.department;
    if (updates.doctorDesignation !== undefined) updateRow.doctor_designation = updates.doctorDesignation;
    if (updates.education !== undefined) updateRow.education = updates.education;
    if (updates.practiceName !== undefined) updateRow.practice_name = updates.practiceName;
    if (updates.tagline !== undefined) updateRow.tagline = updates.tagline;
    if (updates.doctorName !== undefined) updateRow.doctor_name = updates.doctorName;
    if (updates.licenseNumber !== undefined) updateRow.license_number = updates.licenseNumber;
    if (updates.phone !== undefined) updateRow.phone = updates.phone;
    if (updates.email !== undefined) updateRow.email = updates.email;
    if (updates.address !== undefined) updateRow.address = updates.address;
    if (updates.workingDays !== undefined) updateRow.working_days = updates.workingDays;
    if (updates.clinicStartTime !== undefined) updateRow.clinic_start_time = updates.clinicStartTime;
    if (updates.clinicEndTime !== undefined) updateRow.clinic_end_time = updates.clinicEndTime;
    if (updates.appointmentDuration !== undefined) updateRow.appointment_duration = updates.appointmentDuration;
    if (updates.breakStartTime !== undefined) updateRow.break_start_time = updates.breakStartTime;
    if (updates.breakEndTime !== undefined) updateRow.break_end_time = updates.breakEndTime;
    if (updates.notifyEmail !== undefined) updateRow.notify_email = updates.notifyEmail;
    if (updates.notifySms !== undefined) updateRow.notify_sms = updates.notifySms;
    if (updates.autoRemind24h !== undefined) updateRow.auto_remind_24h = updates.autoRemind24h;
    if (updates.operatingHours !== undefined) updateRow.operating_hours = updates.operatingHours;
    if (updates.consultationFee !== undefined) updateRow.consultation_fee = updates.consultationFee;
    if (updates.sessionDurationMinutes !== undefined) updateRow.session_duration_minutes = updates.sessionDurationMinutes;

    const { data, error } = await supabase
      .from('clinic_settings')
      .upsert({ id: 1, ...updateRow })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to update clinic settings: ${error.message}`);
    }
    return mapClinicSettingsFromPg(data);
  }

  // Fallback: MongoDB
  let settings = await ClinicSettings.findOne();
  if (!settings) {
    settings = new ClinicSettings(updates);
  } else {
    Object.assign(settings, updates);
  }
  await settings.save();

  const obj = settings.toObject ? settings.toObject() : settings;
  return {
    ...obj,
    id: 1,
  } as ClinicSettingsRecord;
}
