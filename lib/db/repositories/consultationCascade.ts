import { QueryResultRow } from 'pg';
import { withTransaction, getPostgresPool } from '../postgres';
import {
  mapConsultationFromPg,
  mapPrescriptionFromPg,
  mapFollowUpFromPg,
} from '../mapper';
import {
  createConsultation,
  generateConsultationId,
  ConsultationRecord,
} from './consultationRepository';
import {
  createPrescription,
  PrescriptionRecord,
} from './prescriptionRepository';
import {
  createFollowUp,
  deriveFollowUpStatus,
  FollowUpRecord,
} from './followUpRepository';
import { updatePatient } from './patientRepository';

/**
 * Consultation cascade (clinical encounter + prescription + follow-up queue +
 * patient chart timestamps).
 *
 * When DATABASE_URL is configured every write runs inside one PostgreSQL
 * transaction (BEGIN / COMMIT / ROLLBACK) through the shared pg pool. Without a
 * pool the writes are applied sequentially via the Supabase client (or the
 * preserved MongoDB implementation) - the returned `transactional` flag tells
 * callers which path executed so this limitation is never silent.
 */

export interface ConsultationCascadeInput {
  consultation: Partial<ConsultationRecord>;
  patient: {
    patientId: string;
    fullName: string;
    age?: number;
    gender?: string;
    phone?: string;
  };
  doctorLicense?: string;
  followUpStatus?: string;
  actorId?: string;
}

export interface ConsultationCascadeResult {
  consultation: ConsultationRecord;
  prescription: PrescriptionRecord | null;
  followUp: FollowUpRecord | null;
  transactional: boolean;
}

async function nextSequenceId(
  client: { query: (text: string, params?: any[]) => Promise<{ rows: QueryResultRow[] }> },
  table: string,
  idColumn: string,
  prefix: string,
  base: number
): Promise<string> {
  const countRes = await client.query(`SELECT COUNT(*)::int AS total FROM ${table}`);
  const total = Number(countRes.rows[0]?.total || 0);

  let candidate = base + total + 1;
  // Guard against gaps/duplicates caused by concurrent inserts.
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidateId = `${prefix}-${candidate}`;
    const existsRes = await client.query(
      `SELECT 1 FROM ${table} WHERE ${idColumn} = $1 LIMIT 1`,
      [candidateId]
    );
    if (existsRes.rows.length === 0) return candidateId;
    candidate += 1;
  }

  throw new Error(`Unable to allocate a unique ${prefix} identifier.`);
}

export async function createConsultationCascade(
  input: ConsultationCascadeInput
): Promise<ConsultationCascadeResult> {
  const data = input.consultation;
  const patient = input.patient;
  const consultationId = data.consultationId || (await generateConsultationId());
  const consultationDate = data.consultationDate || new Date().toISOString().split('T')[0];
  const doctorId = data.doctorId || data.clinicianId || 'USR-001';
  const doctorName = data.doctorName || data.clinicianName || 'DR SHAHAB MUHAMMAD';
  const clinicianId = data.clinicianId || doctorId;
  const clinicianName = data.clinicianName || doctorName;
  const medications = Array.isArray(data.medications) ? data.medications : [];
  const followUpDate = data.followUpDate || '';
  const diagnosisLabel =
    data.diagnosis?.primaryTitle && data.diagnosis?.primaryICD
      ? `${data.diagnosis.primaryTitle} (${data.diagnosis.primaryICD})`
      : data.diagnosis?.primaryTitle || data.diagnosis?.primaryICD || 'Clinical consultation';
  const followUpStatus = input.followUpStatus || deriveFollowUpStatus(followUpDate, 'Upcoming');

  const pool = getPostgresPool();

  if (pool) {
    return withTransaction(async (client) => {
      const consultationRes = await client.query(
        `INSERT INTO consultations (
           consultation_id, patient_id, patient_name, doctor_id, doctor_name,
           clinician_id, clinician_name, consultation_date, time, visit_type,
           presenting_complaint, clinical_observations, mental_status_exam,
           assessment, diagnosis, treatment_plan, medications, follow_up_date,
           notes, follow_up_notes
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
         ) RETURNING *;`,
        [
          consultationId,
          patient.patientId,
          patient.fullName,
          doctorId,
          doctorName,
          clinicianId,
          clinicianName,
          consultationDate,
          data.time || '10:00 AM',
          data.visitType || 'Follow-up Consultation',
          data.presentingComplaint || '',
          data.clinicalObservations || '',
          data.mentalStatusExam || {},
          data.assessment || '',
          data.diagnosis || {},
          data.treatmentPlan || '',
          JSON.stringify(medications),
          followUpDate,
          data.notes || '',
          data.followUpNotes || '',
        ]
      );

      let prescription: PrescriptionRecord | null = null;

      if (medications.length > 0) {
        const prescriptionId = await nextSequenceId(
          client,
          'prescriptions',
          'prescription_id',
          'RX',
          900
        );
        const prescriptionRes = await client.query(
          `INSERT INTO prescriptions (
             prescription_id, patient_id, patient_name, patient_age, patient_gender,
             doctor_id, doctor_name, clinician_id, clinician_name, doctor_license,
             prescription_date, date_issued, consultation_id, diagnosis, medications,
             treatment_plan, treatment_notes, status
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             $11, $12, $13, $14, $15, $16, $17, $18
           ) RETURNING *;`,
          [
            prescriptionId,
            patient.patientId,
            patient.fullName,
            patient.age ?? 30,
            patient.gender || 'Other',
            doctorId,
            doctorName,
            clinicianId,
            clinicianName,
            input.doctorLicense || 'NY-MED-849201',
            consultationDate,
            consultationDate,
            consultationId,
            diagnosisLabel,
            JSON.stringify(medications),
            data.treatmentPlan || '',
            data.treatmentPlan || '',
            'Active',
          ]
        );
        prescription = mapPrescriptionFromPg(prescriptionRes.rows[0]);
      }

      let followUp: FollowUpRecord | null = null;

      if (followUpDate) {
        const followUpId = await nextSequenceId(client, 'follow_ups', 'follow_up_id', 'FLP', 300);
        const followUpRes = await client.query(
          `INSERT INTO follow_ups (
             follow_up_id, patient_id, patient_name, phone, doctor_id,
             assigned_doctor, consultation_id, last_consultation_date,
             follow_up_date, reason, priority, status, notes
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
           ) RETURNING *;`,
          [
            followUpId,
            patient.patientId,
            patient.fullName,
            patient.phone || '',
            doctorId,
            doctorName,
            consultationId,
            consultationDate,
            followUpDate,
            data.followUpNotes || `Clinical follow-up for ${diagnosisLabel}`,
            'Routine',
            followUpStatus,
            data.followUpNotes || '',
          ]
        );
        followUp = mapFollowUpFromPg(followUpRes.rows[0]);
      }

      await client.query(
        `UPDATE patients
            SET last_visit_date = $1,
                next_follow_up_date = CASE WHEN $2 = '' THEN next_follow_up_date ELSE $2 END,
                updated_by = $3
          WHERE patient_id = $4`,
        [consultationDate, followUpDate, input.actorId || 'SYSTEM', patient.patientId]
      );

      return {
        consultation: mapConsultationFromPg(consultationRes.rows[0]),
        prescription,
        followUp,
        transactional: true,
      };
    });
  }

  // Sequential fallback: Supabase client (or legacy MongoDB) without a pg pool.
  const consultation = await createConsultation({
    ...data,
    consultationId,
    patientId: patient.patientId,
    patientName: patient.fullName,
    doctorId,
    doctorName,
    clinicianId,
    clinicianName,
    consultationDate,
  });

  let prescription: PrescriptionRecord | null = null;

  if (medications.length > 0) {
    prescription = await createPrescription({
      patientId: patient.patientId,
      patientName: patient.fullName,
      patientAge: patient.age,
      patientGender: patient.gender,
      doctorId,
      doctorName,
      clinicianId,
      clinicianName,
      doctorLicense: input.doctorLicense || 'NY-MED-849201',
      prescriptionDate: consultationDate,
      consultationId,
      diagnosis: diagnosisLabel,
      medications,
      treatmentPlan: data.treatmentPlan || '',
      status: 'Active',
    });
  }

  let followUp: FollowUpRecord | null = null;

  if (followUpDate) {
    followUp = await createFollowUp({
      patientId: patient.patientId,
      patientName: patient.fullName,
      phone: patient.phone || '',
      doctorId,
      assignedDoctor: doctorName,
      consultationId,
      lastConsultationDate: consultationDate,
      followUpDate,
      reason: data.followUpNotes || `Clinical follow-up for ${diagnosisLabel}`,
      priority: 'Routine',
      status: followUpStatus,
      notes: data.followUpNotes || '',
    });
  }

  await updatePatient(patient.patientId, {
    lastVisitDate: consultationDate,
    ...(followUpDate ? { nextFollowUpDate: followUpDate } : {}),
    updatedBy: input.actorId || 'SYSTEM',
  });

  return { consultation, prescription, followUp, transactional: false };
}
