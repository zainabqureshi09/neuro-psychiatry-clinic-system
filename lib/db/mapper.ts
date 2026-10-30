/**
 * NPCS Bidirectional Data Mapper
 * Bridges PostgreSQL snake_case columns & JSONB structures with
 * TypeScript camelCase domain entities to guarantee 100% frontend API contract preservation.
 */

export function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function toSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Maps an arbitrary row object from snake_case keys to camelCase keys
 */
export function mapRowToCamelCase<T = Record<string, any>>(row: Record<string, any> | null | undefined): T | null {
  if (!row) return null;
  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(row)) {
    const camelKey = toCamelCase(key);
    result[camelKey] = value;
  }

  // Guarantee standard id property
  if (result.id === undefined && row.id !== undefined) {
    result.id = row.id;
  }

  return result as T;
}

/**
 * Maps camelCase object keys to snake_case for PostgreSQL queries / inserts
 */
export function mapObjectToSnakeCase(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'id' || key === '_id') {
      continue;
    }
    const snakeKey = toSnakeCase(key);
    result[snakeKey] = value;
  }
  return result;
}

// ==============================================================================
// SPECIFIC ENTITY MAPPERS
// ==============================================================================

export function mapUserFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    phone: row.phone || '',
    avatar: row.avatar || '',
    title: row.title || '',
    department: row.department || '',
    permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions || {},
    isActive: row.is_active,
    lastActive: row.last_active || 'Never',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPatientFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.patient_id || row.id,
    _id: row.id,
    patientId: row.patient_id,
    fullName: row.full_name,
    dateOfBirth: row.date_of_birth,
    age: row.age,
    gender: row.gender,
    phone: row.phone,
    email: row.email || '',
    address: row.address || '',
    emergencyContact: typeof row.emergency_contact === 'string' ? JSON.parse(row.emergency_contact) : row.emergency_contact || {},
    clinicalIntake: typeof row.clinical_intake === 'string' ? JSON.parse(row.clinical_intake) : row.clinical_intake || {},
    status: row.status,
    registeredDate: row.registered_date,
    lastVisitDate: row.last_visit_date || 'N/A',
    nextFollowUpDate: row.next_follow_up_date || 'N/A',
    isActive: row.is_active,
    createdBy: row.created_by || '',
    updatedBy: row.updated_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapConsultationFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.consultation_id || row.id,
    _id: row.id,
    consultationId: row.consultation_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    clinicianId: row.clinician_id || row.doctor_id,
    clinicianName: row.clinician_name || row.doctor_name,
    consultationDate: row.consultation_date,
    time: row.time || '10:00 AM',
    visitType: row.visit_type || 'Follow-up Consultation',
    presentingComplaint: row.presenting_complaint,
    clinicalObservations: row.clinical_observations,
    mentalStatusExam: typeof row.mental_status_exam === 'string' ? JSON.parse(row.mental_status_exam) : row.mental_status_exam || {},
    assessment: row.assessment,
    diagnosis: typeof row.diagnosis === 'string' ? JSON.parse(row.diagnosis) : row.diagnosis || {},
    treatmentPlan: row.treatment_plan,
    medications: typeof row.medications === 'string' ? JSON.parse(row.medications) : row.medications || [],
    followUpDate: row.follow_up_date || '',
    notes: row.notes || '',
    followUpNotes: row.follow_up_notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPrescriptionFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.prescription_id || row.id,
    _id: row.id,
    prescriptionId: row.prescription_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    patientAge: row.patient_age || 30,
    patientGender: row.patient_gender || 'Other',
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    clinicianId: row.clinician_id || row.doctor_id,
    clinicianName: row.clinician_name || row.doctor_name,
    doctorLicense: row.doctor_license || '',
    prescriptionDate: row.prescription_date,
    dateIssued: row.date_issued || row.prescription_date,
    consultationId: row.consultation_id || '',
    diagnosis: row.diagnosis,
    medications: typeof row.medications === 'string' ? JSON.parse(row.medications) : row.medications || [],
    treatmentPlan: row.treatment_plan || '',
    treatmentNotes: row.treatment_notes || row.treatment_plan || '',
    instructions: row.instructions || '',
    notes: row.notes || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAppointmentFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.appointment_id || row.id,
    _id: row.id,
    appointmentId: row.appointment_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    patientPhone: row.patient_phone || '',
    doctorId: row.doctor_id,
    doctorName: row.doctor_name,
    clinicianId: row.clinician_id || row.doctor_id,
    clinicianName: row.clinician_name || row.doctor_name,
    appointmentDate: row.appointment_date,
    appointmentTime: row.appointment_time,
    date: row.appointment_date,
    time: row.appointment_time,
    durationMinutes: row.duration_minutes || 45,
    appointmentType: row.appointment_type,
    type: row.appointment_type,
    notes: row.notes || '',
    room: row.room || 'Consultation Suite 1',
    consultationMode: row.consultation_mode || 'In-Person',
    onlineSessionLink: row.online_session_link || '',
    status: row.status,
    createdBy: row.created_by || '',
    updatedBy: row.updated_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapPaymentFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.payment_id || row.id,
    _id: row.id,
    paymentId: row.payment_id,
    receiptNumber: row.receipt_number,
    patientId: row.patient_id,
    patientName: row.patient_name,
    appointmentId: row.appointment_id || '',
    consultationId: row.consultation_id || '',
    feeCategoryId: row.fee_category_id || '',
    service: row.service,
    feeCategory: row.fee_category || 'Consultation',
    amount: Number(row.amount),
    paymentMethod: row.payment_method || 'Cash',
    paymentStatus: row.payment_status || 'Paid',
    date: row.date,
    paymentDate: row.payment_date || row.date,
    notes: row.notes || '',
    receivedBy: row.received_by || '',
    createdBy: row.created_by || '',
    updatedBy: row.updated_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFeeCategoryFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.category_id || row.id,
    _id: row.id,
    categoryId: row.category_id,
    name: row.name,
    defaultFee: Number(row.default_fee),
    amount: row.amount ? Number(row.amount) : Number(row.default_fee),
    description: row.description || '',
    isActive: row.is_active,
    createdBy: row.created_by || '',
    updatedBy: row.updated_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapFollowUpFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.follow_up_id || row.id,
    _id: row.id,
    followUpId: row.follow_up_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    phone: row.phone || '',
    doctorId: row.doctor_id || '',
    assignedDoctor: row.assigned_doctor,
    consultationId: row.consultation_id || '',
    lastConsultationDate: row.last_consultation_date || 'N/A',
    followUpDate: row.follow_up_date,
    reason: row.reason,
    priority: row.priority || 'Routine',
    status: row.status || 'Upcoming',
    notes: row.notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapTherapySessionFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.session_id || row.id,
    _id: row.id,
    sessionId: row.session_id,
    patientId: row.patient_id,
    patientName: row.patient_name,
    therapistId: row.therapist_id,
    therapistName: row.therapist_name,
    sessionDate: row.session_date,
    durationMinutes: row.duration_minutes || 50,
    sessionType: row.session_type,
    assessment: row.assessment || '',
    counselling: row.counselling || '',
    intervention: row.intervention || '',
    progressNotes: row.progress_notes || '',
    psychometrics: row.psychometrics || '',
    lifestyleInterventions: row.lifestyle_interventions || '',
    followUpPlan: row.follow_up_plan || '',
    followUpDate: row.follow_up_date || '',
    responsibleClinician: row.responsible_clinician || '',
    responsibleClinicianId: row.responsible_clinician_id || '',
    status: row.status || 'Completed',
    createdBy: row.created_by || '',
    updatedBy: row.updated_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAuditLogFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.log_id || row.id,
    _id: row.id,
    logId: row.log_id,
    timestamp: row.timestamp,
    userId: row.user_id,
    userName: row.user_name,
    userRole: row.user_role,
    action: row.action,
    module: row.module,
    resourceType: row.resource_type || '',
    resourceId: row.resource_id || '',
    patientRef: row.patient_ref || '',
    description: row.description,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata || {},
    createdAt: row.created_at,
  };
}

export function mapClinicSettingsFromPg(row: any): any {
  if (!row) return null;
  return {
    id: row.id,
    clinicName: row.clinic_name,
    department: row.department,
    doctorDesignation: row.doctor_designation,
    education: row.education,
    practiceName: row.practice_name,
    tagline: row.tagline,
    doctorName: row.doctor_name,
    licenseNumber: row.license_number,
    phone: row.phone,
    email: row.email,
    address: row.address,
    workingDays: row.working_days || ['Monday', 'Wednesday', 'Friday'],
    clinicStartTime: row.clinic_start_time || '18:00',
    clinicEndTime: row.clinic_end_time || '20:00',
    appointmentDuration: row.appointment_duration || 45,
    breakStartTime: row.break_start_time || '',
    breakEndTime: row.break_end_time || '',
    notifyEmail: row.notify_email,
    notifySms: row.notify_sms,
    autoRemind24h: row.auto_remind_24h,
    operatingHours: row.operating_hours,
    consultationFee: Number(row.consultation_fee),
    sessionDurationMinutes: row.session_duration_minutes || 45,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
