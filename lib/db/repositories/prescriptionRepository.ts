import { getSupabaseClient } from '../supabase';
import { mapPrescriptionFromPg } from '../mapper';
import Prescription, { IPrescription } from '@/models/Prescription';

export interface PrescriptionRecord {
  id: string;
  _id?: any;
  prescriptionId: string;
  patientId: string;
  patientName: string;
  patientAge: number;
  patientGender: string;
  doctorId: string;
  doctorName: string;
  clinicianId: string;
  clinicianName: string;
  doctorLicense?: string;
  prescriptionDate: string;
  dateIssued?: string;
  consultationId?: string;
  diagnosis: string;
  medications: any[];
  treatmentPlan?: string;
  treatmentNotes?: string;
  instructions?: string;
  notes?: string;
  status: 'Active' | 'Completed' | 'Discontinued';
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export async function generatePrescriptionId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count } = await supabase.from('prescriptions').select('*', { count: 'exact', head: true });
    return `RX-${900 + (count || 0) + 1}`;
  }

  const count = await Prescription.countDocuments();
  return `RX-${900 + count + 1}`;
}

export async function listPrescriptions(filter: {
  patientId?: string;
  doctorId?: string;
  status?: string;
  page?: number;
  limit?: number;
} = {}): Promise<PrescriptionRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase.from('prescriptions').select('*');

    if (filter.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter.doctorId) query = query.or(`doctor_id.eq.${filter.doctorId},clinician_id.eq.${filter.doctorId}`);
    if (filter.status && filter.status !== 'All') query = query.eq('status', filter.status);

    query = query.order('prescription_date', { ascending: false });

    if (filter.page && filter.limit) {
      const from = (filter.page - 1) * filter.limit;
      const to = from + filter.limit - 1;
      query = query.range(from, to);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Database error querying prescriptions: ${error.message}`);
    }
    return (data || []).map(mapPrescriptionFromPg);
  }

  // Fallback: MongoDB
  const mongoFilter: any = {};
  if (filter.patientId) mongoFilter.patientId = filter.patientId;
  if (filter.doctorId) {
    mongoFilter.$or = [{ doctorId: filter.doctorId }, { clinicianId: filter.doctorId }];
  }
  if (filter.status && filter.status !== 'All') {
    mongoFilter.status = filter.status;
  }

  let query = Prescription.find(mongoFilter).sort({ prescriptionDate: -1 });
  if (filter.page && filter.limit) {
    query = query.skip((filter.page - 1) * filter.limit).limit(filter.limit);
  }

  const docs = await query.lean();
  return docs.map((d: any) => ({
    ...d,
    id: d.prescriptionId || d._id?.toString(),
  }));
}

export async function getPrescriptionById(id: string): Promise<PrescriptionRecord | null> {
  if (!id) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('prescriptions').select('*');

    if (isUuid) {
      query = query.or(`prescription_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('prescription_id', id);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Database error fetching prescription: ${error.message}`);
    }
    return mapPrescriptionFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const doc = await Prescription.findOne({
    $or: [{ prescriptionId: id }, { _id: isValidObjectId ? id : null }],
  }).lean();

  if (!doc) return null;
  return {
    ...doc,
    id: (doc as any).prescriptionId || (doc as any)._id?.toString(),
  } as PrescriptionRecord;
}

export async function createPrescription(data: Partial<PrescriptionRecord>): Promise<PrescriptionRecord> {
  const prescriptionId = data.prescriptionId || (await generatePrescriptionId());
  const clinicianId = data.clinicianId || data.doctorId || 'USR-001';
  const clinicianName = data.clinicianName || data.doctorName || 'Doctor';
  const prescriptionDate = data.prescriptionDate || data.dateIssued || new Date().toISOString().split('T')[0];

  const supabase = getSupabaseClient();
  if (supabase) {
    const insertRow = {
      prescription_id: prescriptionId,
      patient_id: data.patientId,
      patient_name: data.patientName,
      patient_age: data.patientAge || 30,
      patient_gender: data.patientGender || 'Other',
      doctor_id: data.doctorId || clinicianId,
      doctor_name: data.doctorName || clinicianName,
      clinician_id: clinicianId,
      clinician_name: clinicianName,
      doctor_license: data.doctorLicense || '',
      prescription_date: prescriptionDate,
      date_issued: data.dateIssued || prescriptionDate,
      consultation_id: data.consultationId || '',
      diagnosis: data.diagnosis || '',
      medications: data.medications || [],
      treatment_plan: data.treatmentPlan || data.treatmentNotes || '',
      treatment_notes: data.treatmentNotes || data.treatmentPlan || '',
      instructions: data.instructions || '',
      notes: data.notes || '',
      status: data.status || 'Active',
    };

    const { data: created, error } = await supabase
      .from('prescriptions')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create prescription: ${error.message}`);
    }
    return mapPrescriptionFromPg(created);
  }

  // Fallback: MongoDB
  const newPrescription = new Prescription({
    ...data,
    prescriptionId,
    doctorId: data.doctorId || clinicianId,
    doctorName: data.doctorName || clinicianName,
    clinicianId,
    clinicianName,
    prescriptionDate,
    dateIssued: data.dateIssued || prescriptionDate,
    treatmentPlan: data.treatmentPlan || data.treatmentNotes || '',
    treatmentNotes: data.treatmentNotes || data.treatmentPlan || '',
  });

  await newPrescription.save();
  const obj: any = newPrescription.toObject ? newPrescription.toObject() : newPrescription;
  return {
    ...obj,
    id: obj.prescriptionId || obj._id?.toString(),
  } as PrescriptionRecord;
}

export async function updatePrescription(
  id: string,
  updates: Partial<PrescriptionRecord>
): Promise<PrescriptionRecord | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const updateRow: Record<string, any> = {};

    if (updates.diagnosis !== undefined) updateRow.diagnosis = updates.diagnosis;
    if (updates.medications !== undefined) updateRow.medications = updates.medications;
    if (updates.treatmentPlan !== undefined) {
      updateRow.treatment_plan = updates.treatmentPlan;
      updateRow.treatment_notes = updates.treatmentPlan;
    }
    if (updates.instructions !== undefined) updateRow.instructions = updates.instructions;
    if (updates.notes !== undefined) updateRow.notes = updates.notes;
    if (updates.status !== undefined) updateRow.status = updates.status;

    let query = supabase.from('prescriptions').update(updateRow);
    if (isUuid) {
      query = query.or(`prescription_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('prescription_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to update prescription: ${error.message}`);
    }
    return mapPrescriptionFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const prescription = await Prescription.findOne({
    $or: [{ prescriptionId: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!prescription) return null;
  Object.assign(prescription, updates);
  if (updates.treatmentPlan && !updates.treatmentNotes) {
    prescription.treatmentNotes = updates.treatmentPlan;
  }
  await prescription.save();

  const obj: any = prescription.toObject ? prescription.toObject() : prescription;
  return {
    ...obj,
    id: obj.prescriptionId || obj._id?.toString(),
  } as PrescriptionRecord;
}

export async function deletePrescription(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('prescriptions').delete();
    if (isUuid) {
      query = query.or(`prescription_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('prescription_id', id);
    }
    const { error } = await query;
    return !error;
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const result = await Prescription.deleteOne({
    $or: [{ prescriptionId: id }, { _id: isValidObjectId ? id : null }],
  });
  return (result.deletedCount || 0) > 0;
}
