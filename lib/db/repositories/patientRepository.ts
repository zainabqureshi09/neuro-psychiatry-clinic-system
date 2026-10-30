import { getDatabaseConfig } from '../config';
import { getSupabaseClient } from '../supabase';
import { mapPatientFromPg } from '../mapper';
import Patient, { IPatient } from '@/models/Patient';

export interface ListPatientsOptions {
  search?: string;
  gender?: string;
  status?: string;
  page?: number;
  limit?: number;
  includeInactive?: boolean;
}

export interface PatientRecord {
  id: string;
  _id?: any;
  patientId: string;
  fullName: string;
  dateOfBirth: string;
  age: number;
  gender: string;
  phone: string;
  email?: string;
  address?: string;
  emergencyContact: {
    name?: string;
    relationship?: string;
    phone?: string;
  };
  clinicalIntake: {
    presentingComplaint?: string;
    psychiatricHistory?: string;
    currentMedications?: string;
    allergies?: string;
    familyHistory?: string;
    riskAssessment?: string;
  };
  status: string;
  registeredDate: string;
  lastVisitDate?: string;
  nextFollowUpDate?: string;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

/**
 * Generates the next sequential Patient ID (PX-XXXX format)
 */
export async function generatePatientId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count, error } = await supabase
      .from('patients')
      .select('patient_id', { count: 'exact', head: true });

    const totalCount = (!error && typeof count === 'number') ? count : 0;
    let candidateNum = 9401 + totalCount;
    let candidateId = `PX-${candidateNum}`;

    let exists = true;
    while (exists) {
      const { data } = await supabase
        .from('patients')
        .select('patient_id')
        .eq('patient_id', candidateId)
        .maybeSingle();

      if (!data) {
        exists = false;
      } else {
        candidateNum++;
        candidateId = `PX-${candidateNum}`;
      }
    }
    return candidateId;
  }

  // Fallback to MongoDB
  const count = await Patient.countDocuments();
  let candidateNum = 9401 + count;
  let candidateId = `PX-${candidateNum}`;
  while (await Patient.exists({ patientId: candidateId })) {
    candidateNum++;
    candidateId = `PX-${candidateNum}`;
  }
  return candidateId;
}

/**
 * List patients with pagination, search, and filtering
 */
export async function listPatients(options: ListPatientsOptions = {}): Promise<{
  data: PatientRecord[];
  total: number;
  page: number;
  limit: number;
}> {
  const {
    search = '',
    gender = '',
    status = '',
    page = 1,
    limit = 50,
    includeInactive = false,
  } = options;

  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase.from('patients').select('*', { count: 'exact' });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    if (search) {
      query = query.or(
        `patient_id.ilike.%${search}%,full_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`
      );
    }

    if (gender && gender !== 'All') {
      query = query.eq('gender', gender);
    }

    if (status && status !== 'All') {
      query = query.eq('status', status);
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    query = query.order('registered_date', { ascending: false }).range(from, to);

    const { data, count, error } = await query;
    if (error) {
      throw new Error(`Database error querying patients: ${error.message}`);
    }

    const mapped = (data || []).map(mapPatientFromPg);
    return {
      data: mapped,
      total: count || mapped.length,
      page,
      limit,
    };
  }

  // Fallback: MongoDB
  const filter: any = {};
  if (!includeInactive) {
    filter.isActive = { $ne: false };
  }

  if (search) {
    const searchRegex = new RegExp(search, 'i');
    filter.$or = [
      { patientId: searchRegex },
      { fullName: searchRegex },
      { phone: searchRegex },
      { email: searchRegex },
    ];
  }

  if (gender && gender !== 'All') {
    filter.gender = gender;
  }

  if (status && status !== 'All') {
    filter.status = status;
  }

  const total = await Patient.countDocuments(filter);
  const skip = (page - 1) * limit;
  const docs = await Patient.find(filter)
    .sort({ registeredDate: -1, createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const formatted = docs.map((doc: any) => ({
    ...doc,
    id: doc.patientId || doc._id?.toString(),
  }));

  return {
    data: formatted,
    total,
    page,
    limit,
  };
}

/**
 * Find a patient by patientId (PX-XXXX) or internal UUID / ObjectId
 */
export async function getPatientById(id: string): Promise<PatientRecord | null> {
  if (!id) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('patients').select('*');

    if (isUuid) {
      query = query.or(`patient_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('patient_id', id);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Database error fetching patient ${id}: ${error.message}`);
    }
    return mapPatientFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const doc = await Patient.findOne({
    $or: [{ patientId: id }, { _id: isValidObjectId ? id : null }],
  }).lean();

  if (!doc) return null;
  return {
    ...doc,
    id: (doc as any).patientId || (doc as any)._id?.toString(),
  } as PatientRecord;
}

/**
 * Creates a new patient
 */
export async function createPatient(data: Partial<PatientRecord>): Promise<PatientRecord> {
  const patientId = data.patientId || (await generatePatientId());
  const registeredDate = data.registeredDate || new Date().toISOString().split('T')[0];

  const supabase = getSupabaseClient();
  if (supabase) {
    const insertRow = {
      patient_id: patientId,
      full_name: data.fullName,
      date_of_birth: data.dateOfBirth,
      age: data.age || 0,
      gender: data.gender || 'Other',
      phone: data.phone,
      email: data.email || '',
      address: data.address || '',
      emergency_contact: data.emergencyContact || {},
      clinical_intake: data.clinicalIntake || {},
      status: data.status || 'Active',
      registered_date: registeredDate,
      last_visit_date: data.lastVisitDate || 'N/A',
      next_follow_up_date: data.nextFollowUpDate || 'N/A',
      is_active: data.isActive !== undefined ? data.isActive : true,
      created_by: data.createdBy || '',
      updated_by: data.updatedBy || '',
    };

    const { data: created, error } = await supabase
      .from('patients')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to insert patient record: ${error.message}`);
    }

    return mapPatientFromPg(created);
  }

  // Fallback: MongoDB
  const newPatient = new Patient({
    ...data,
    patientId,
    registeredDate,
    isActive: data.isActive !== undefined ? data.isActive : true,
  });

  await newPatient.save();
  const obj: any = newPatient.toObject ? newPatient.toObject() : newPatient;
  return {
    ...obj,
    id: obj.patientId || obj._id?.toString(),
  } as PatientRecord;
}

/**
 * Updates an existing patient record
 */
export async function updatePatient(id: string, updates: Partial<PatientRecord>): Promise<PatientRecord | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const updateRow: Record<string, any> = {};

    if (updates.fullName !== undefined) updateRow.full_name = updates.fullName;
    if (updates.dateOfBirth !== undefined) updateRow.date_of_birth = updates.dateOfBirth;
    if (updates.age !== undefined) updateRow.age = updates.age;
    if (updates.gender !== undefined) updateRow.gender = updates.gender;
    if (updates.phone !== undefined) updateRow.phone = updates.phone;
    if (updates.email !== undefined) updateRow.email = updates.email;
    if (updates.address !== undefined) updateRow.address = updates.address;
    if (updates.emergencyContact !== undefined) updateRow.emergency_contact = updates.emergencyContact;
    if (updates.clinicalIntake !== undefined) updateRow.clinical_intake = updates.clinicalIntake;
    if (updates.status !== undefined) updateRow.status = updates.status;
    if (updates.lastVisitDate !== undefined) updateRow.last_visit_date = updates.lastVisitDate;
    if (updates.nextFollowUpDate !== undefined) updateRow.next_follow_up_date = updates.nextFollowUpDate;
    if (updates.isActive !== undefined) updateRow.is_active = updates.isActive;
    if (updates.updatedBy !== undefined) updateRow.updated_by = updates.updatedBy;

    let query = supabase.from('patients').update(updateRow);
    if (isUuid) {
      query = query.or(`patient_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('patient_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to update patient: ${error.message}`);
    }
    return mapPatientFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const patient = await Patient.findOne({
    $or: [{ patientId: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!patient) return null;
  Object.assign(patient, updates);
  await patient.save();

  const obj: any = patient.toObject ? patient.toObject() : patient;
  return {
    ...obj,
    id: obj.patientId || obj._id?.toString(),
  } as PatientRecord;
}

/**
 * SOFT DELETION for patients.
 * In accordance with clinic compliance rules:
 * - Sets is_active = false
 * - Sets status = 'Discharged'
 * - Preserves clinical records, prescriptions, billing history, appointments, and audit trails.
 * - Does NOT permanently delete the database row.
 */
export async function softDeletePatient(id: string, updatedBy: string = 'SYSTEM'): Promise<PatientRecord | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase
      .from('patients')
      .update({
        is_active: false,
        status: 'Discharged',
        updated_by: updatedBy,
      });

    if (isUuid) {
      query = query.or(`patient_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('patient_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to soft-delete patient: ${error.message}`);
    }
    return mapPatientFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const patient = await Patient.findOne({
    $or: [{ patientId: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!patient) return null;

  patient.isActive = false;
  patient.status = 'Discharged';
  patient.updatedBy = updatedBy;
  await patient.save();

  const obj: any = patient.toObject ? patient.toObject() : patient;
  return {
    ...obj,
    id: obj.patientId || obj._id?.toString(),
  } as PatientRecord;
}
