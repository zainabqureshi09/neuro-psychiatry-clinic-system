import { getSupabaseClient } from '../supabase';
import { mapConsultationFromPg } from '../mapper';
import { withTransaction, getPostgresPool } from '../postgres';
import Consultation, { IConsultation } from '@/models/Consultation';
import { createPrescription, PrescriptionRecord } from './prescriptionRepository';
import { createFollowUp, deriveFollowUpStatus, FollowUpRecord } from './followUpRepository';
import { updatePatient } from './patientRepository';

export interface ConsultationRecord {
  id: string;
  _id?: any;
  consultationId: string;
  patientId: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  clinicianId: string;
  clinicianName: string;
  consultationDate: string;
  time: string;
  visitType: string;
  presentingComplaint: string;
  clinicalObservations: string;
  mentalStatusExam: any;
  assessment: string;
  diagnosis: {
    primaryICD?: string;
    primaryTitle?: string;
    secondaryICD?: string;
    secondaryTitle?: string;
  };
  treatmentPlan: string;
  medications: any[];
  followUpDate?: string;
  notes?: string;
  followUpNotes?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function generateConsultationId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count } = await supabase.from('consultations').select('*', { count: 'exact', head: true });
    return `CNS-${100 + (count || 0) + 1}`;
  }

  const count = await Consultation.countDocuments();
  return `CNS-${100 + count + 1}`;
}

export async function listConsultations(filter: {
  patientId?: string;
  doctorId?: string;
  date?: string;
  page?: number;
  limit?: number;
} = {}): Promise<ConsultationRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase.from('consultations').select('*');

    if (filter.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter.doctorId) query = query.or(`doctor_id.eq.${filter.doctorId},clinician_id.eq.${filter.doctorId}`);
    if (filter.date) query = query.eq('consultation_date', filter.date);

    query = query.order('consultation_date', { ascending: false });

    if (filter.page && filter.limit) {
      const from = (filter.page - 1) * filter.limit;
      const to = from + filter.limit - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Database error querying consultations: ${error.message}`);
    }
    return (data || []).map(mapConsultationFromPg);
  }

  // Fallback: MongoDB
  const mongoFilter: any = {};
  if (filter.patientId) mongoFilter.patientId = filter.patientId;
  if (filter.doctorId) {
    mongoFilter.$or = [{ doctorId: filter.doctorId }, { clinicianId: filter.doctorId }];
  }
  if (filter.date) mongoFilter.consultationDate = filter.date;

  let query = Consultation.find(mongoFilter).sort({ consultationDate: -1 });
  if (filter.page && filter.limit) {
    query = query.skip((filter.page - 1) * filter.limit).limit(filter.limit);
  }

  const docs = await query.lean();
  return docs.map((d: any) => ({
    ...d,
    id: d.consultationId || d._id?.toString(),
  }));
}

export async function getConsultationById(id: string): Promise<ConsultationRecord | null> {
  if (!id) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('consultations').select('*');

    if (isUuid) {
      query = query.or(`consultation_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('consultation_id', id);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Database error fetching consultation: ${error.message}`);
    }
    return mapConsultationFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const doc = await Consultation.findOne({
    $or: [{ consultationId: id }, { _id: isValidObjectId ? id : null }],
  }).lean();

  if (!doc) return null;
  return {
    ...doc,
    id: (doc as any).consultationId || (doc as any)._id?.toString(),
  } as ConsultationRecord;
}

export async function createConsultation(data: Partial<ConsultationRecord>): Promise<ConsultationRecord> {
  const consultationId = data.consultationId || (await generateConsultationId());
  const clinicianId = data.clinicianId || data.doctorId || 'USR-001';
  const clinicianName = data.clinicianName || data.doctorName || 'Doctor';

  const supabase = getSupabaseClient();
  if (supabase) {
    const insertRow = {
      consultation_id: consultationId,
      patient_id: data.patientId,
      patient_name: data.patientName,
      doctor_id: data.doctorId || clinicianId,
      doctor_name: data.doctorName || clinicianName,
      clinician_id: clinicianId,
      clinician_name: clinicianName,
      consultation_date: data.consultationDate || new Date().toISOString().split('T')[0],
      time: data.time || '10:00 AM',
      visit_type: data.visitType || 'Follow-up Consultation',
      presenting_complaint: data.presentingComplaint || '',
      clinical_observations: data.clinicalObservations || '',
      mental_status_exam: data.mentalStatusExam || {},
      assessment: data.assessment || '',
      diagnosis: data.diagnosis || {},
      treatment_plan: data.treatmentPlan || '',
      medications: data.medications || [],
      follow_up_date: data.followUpDate || '',
      notes: data.notes || '',
      follow_up_notes: data.followUpNotes || '',
    };

    const { data: created, error } = await supabase
      .from('consultations')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create consultation: ${error.message}`);
    }
    return mapConsultationFromPg(created);
  }

  // Fallback: MongoDB
  const newConsultation = new Consultation({
    ...data,
    consultationId,
    doctorId: data.doctorId || clinicianId,
    doctorName: data.doctorName || clinicianName,
    clinicianId,
    clinicianName,
  });

  await newConsultation.save();
  const obj: any = newConsultation.toObject ? newConsultation.toObject() : newConsultation;
  return {
    ...obj,
    id: obj.consultationId || obj._id?.toString(),
  } as ConsultationRecord;
}

export async function updateConsultation(
  id: string,
  updates: Partial<ConsultationRecord>
): Promise<ConsultationRecord | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const updateRow: Record<string, any> = {};

    if (updates.presentingComplaint !== undefined) updateRow.presenting_complaint = updates.presentingComplaint;
    if (updates.clinicalObservations !== undefined) updateRow.clinical_observations = updates.clinicalObservations;
    if (updates.mentalStatusExam !== undefined) updateRow.mental_status_exam = updates.mentalStatusExam;
    if (updates.assessment !== undefined) updateRow.assessment = updates.assessment;
    if (updates.diagnosis !== undefined) updateRow.diagnosis = updates.diagnosis;
    if (updates.treatmentPlan !== undefined) updateRow.treatment_plan = updates.treatmentPlan;
    if (updates.medications !== undefined) updateRow.medications = updates.medications;
    if (updates.followUpDate !== undefined) updateRow.follow_up_date = updates.followUpDate;
    if (updates.notes !== undefined) updateRow.notes = updates.notes;
    if (updates.followUpNotes !== undefined) updateRow.follow_up_notes = updates.followUpNotes;

    let query = supabase.from('consultations').update(updateRow);
    if (isUuid) {
      query = query.or(`consultation_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('consultation_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to update consultation: ${error.message}`);
    }
    return mapConsultationFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const consultation = await Consultation.findOne({
    $or: [{ consultationId: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!consultation) return null;
  Object.assign(consultation, updates);
  await consultation.save();

  const obj: any = consultation.toObject ? consultation.toObject() : consultation;
  return {
    ...obj,
    id: obj.consultationId || obj._id?.toString(),
  } as ConsultationRecord;
}

/**
 * Fetches a consultation scoped to a specific patient chart.
 * Prevents cross-chart record disclosure on nested patient routes.
 */
export async function getConsultationByIdForPatient(
  id: string,
  patientId: string
): Promise<ConsultationRecord | null> {
  const record = await getConsultationById(id);
  if (!record) return null;
  return record.patientId === patientId ? record : null;
}

export async function deleteConsultation(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('consultations').delete();
    if (isUuid) {
      query = query.or(`consultation_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('consultation_id', id);
    }
    const { error } = await query;
    return !error;
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const result = await Consultation.deleteOne({
    $or: [{ consultationId: id }, { _id: isValidObjectId ? id : null }],
  });
  return (result.deletedCount || 0) > 0;
}
