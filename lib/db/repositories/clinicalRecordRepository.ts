import { getSupabaseClient } from '../supabase';
import { mapRowToCamelCase } from '../mapper';
import ClinicalRecord, { IClinicalRecord } from '@/models/ClinicalRecord';

export interface ClinicalRecordData {
  id?: string;
  _id?: any;
  patientId: string;
  psychiatricHistory?: any;
  medicalHistory?: any;
  personalHistory?: any;
  familyHistory?: any;
  socialHistory?: any;
  mentalStatusExam?: any;
  riskAssessment?: any;
  recordType?: string;
  details?: any;
  author?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function getClinicalRecordsByPatientId(patientId: string): Promise<ClinicalRecordData[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('clinical_records')
      .select('*')
      .eq('patient_id', patientId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Database error fetching clinical records: ${error.message}`);
    }

    return (data || []).map((row) => ({
      id: row.id,
      patientId: row.patient_id,
      psychiatricHistory: typeof row.psychiatric_history === 'string' ? JSON.parse(row.psychiatric_history) : row.psychiatric_history,
      medicalHistory: typeof row.medical_history === 'string' ? JSON.parse(row.medical_history) : row.medical_history,
      personalHistory: typeof row.personal_history === 'string' ? JSON.parse(row.personal_history) : row.personal_history,
      familyHistory: typeof row.family_history === 'string' ? JSON.parse(row.family_history) : row.family_history,
      socialHistory: typeof row.social_history === 'string' ? JSON.parse(row.social_history) : row.social_history,
      mentalStatusExam: typeof row.mental_status_exam === 'string' ? JSON.parse(row.mental_status_exam) : row.mental_status_exam,
      riskAssessment: typeof row.risk_assessment === 'string' ? JSON.parse(row.risk_assessment) : row.risk_assessment,
      recordType: row.record_type || 'CLINICAL_RECORD',
      details: typeof row.details === 'string' ? JSON.parse(row.details) : row.details || {},
      author: row.author || 'System',
      createdBy: row.created_by || 'System',
      updatedBy: row.updated_by || 'System',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Fallback: MongoDB
  const docs = await ClinicalRecord.find({ patientId }).sort({ createdAt: -1 }).lean();
  return docs.map((d: any) => ({
    ...d,
    id: d._id?.toString(),
  }));
}

export async function createClinicalRecord(data: Partial<ClinicalRecordData>): Promise<ClinicalRecordData> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const insertRow = {
      patient_id: data.patientId,
      psychiatric_history: data.psychiatricHistory || {},
      medical_history: data.medicalHistory || {},
      personal_history: data.personalHistory || {},
      family_history: data.familyHistory || {},
      social_history: data.socialHistory || {},
      mental_status_exam: data.mentalStatusExam || {},
      risk_assessment: data.riskAssessment || {},
      record_type: data.recordType || 'CLINICAL_RECORD',
      details: data.details || {},
      author: data.author || 'System',
      created_by: data.createdBy || 'System',
      updated_by: data.updatedBy || 'System',
    };

    const { data: created, error } = await supabase
      .from('clinical_records')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create clinical record: ${error.message}`);
    }

    return {
      id: created.id,
      patientId: created.patient_id,
      recordType: created.record_type,
      details: created.details,
      author: created.author,
      createdAt: created.created_at,
    };
  }

  // Fallback: MongoDB
  const record = new ClinicalRecord({
    patientId: data.patientId,
    recordType: data.recordType || 'CLINICAL_RECORD',
    details: data.details || data,
    author: data.author || 'System',
    createdBy: data.createdBy || 'SYSTEM',
  });

  await record.save();
  const obj: any = record.toObject ? record.toObject() : record;
  return {
    ...obj,
    id: obj._id?.toString(),
  };
}

/**
 * Lists clinical records across patients (used by the admin backup export).
 */
export async function listClinicalRecords(limit: number = 5000): Promise<ClinicalRecordData[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('clinical_records')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Database error listing clinical records: ${error.message}`);
    }

    return (data || []).map((row) => ({
      id: row.id,
      patientId: row.patient_id,
      psychiatricHistory: row.psychiatric_history,
      medicalHistory: row.medical_history,
      personalHistory: row.personal_history,
      familyHistory: row.family_history,
      socialHistory: row.social_history,
      mentalStatusExam: row.mental_status_exam,
      riskAssessment: row.risk_assessment,
      recordType: row.record_type || 'CLINICAL_RECORD',
      details: row.details || {},
      author: row.author || 'System',
      createdBy: row.created_by || 'System',
      updatedBy: row.updated_by || 'System',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // Fallback: MongoDB
  const docs = await ClinicalRecord.find().sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map((d: any) => ({
    ...d,
    id: d._id?.toString(),
  }));
}

