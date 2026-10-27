-- ==============================================================================
-- NPCS Psychiatry EMR & Clinical Practice System
-- PostgreSQL Schema Migration: 20261026000001_initial_npcs_schema.sql
-- Description: Initial schema migration from MongoDB/Mongoose to PostgreSQL.
-- Covers all 13 core clinical, administrative, financial, and audit models.
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. TRIGGER FUNCTION: Automatic updated_at Timestamps
-- ==============================================================================
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- 3. TABLE: users
-- Source: models/User.ts
-- Staff accounts, roles, custom bcrypt authentication, and RBAC permissions.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'USR-001'
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('ADMIN', 'DOCTOR', 'RECEPTION', 'RECEPTIONIST', 'THERAPIST')),
    phone VARCHAR(50) DEFAULT '',
    avatar TEXT DEFAULT '',
    title VARCHAR(150) DEFAULT '',
    department VARCHAR(150) DEFAULT '',
    permissions JSONB NOT NULL DEFAULT '{
        "canWriteClinicalNotes": false,
        "canPrescribe": false,
        "canManagePatients": true,
        "canManageAppointments": true,
        "canManageUsers": false,
        "canViewReports": false
    }'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_active VARCHAR(100) DEFAULT 'Never',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 4. TABLE: patients
-- Source: models/Patient.ts
-- Patient demographics, status, emergency contact, and baseline intake.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS patients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'PX-9402'
    full_name VARCHAR(200) NOT NULL,
    date_of_birth VARCHAR(50) NOT NULL, -- 'YYYY-MM-DD'
    age INT NOT NULL CHECK (age >= 0 AND age <= 150),
    gender VARCHAR(50) NOT NULL CHECK (gender IN ('Male', 'Female', 'Other', 'Prefer not to say')),
    phone VARCHAR(50) NOT NULL,
    email VARCHAR(255) DEFAULT '',
    address TEXT DEFAULT '',
    emergency_contact JSONB NOT NULL DEFAULT '{
        "name": "",
        "relationship": "",
        "phone": ""
    }'::jsonb,
    clinical_intake JSONB NOT NULL DEFAULT '{
        "presentingComplaint": "",
        "psychiatricHistory": "",
        "currentMedications": "",
        "allergies": "",
        "familyHistory": "",
        "riskAssessment": "Low"
    }'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'In Treatment', 'Discharged', 'Pending Intake')),
    registered_date VARCHAR(50) NOT NULL, -- 'YYYY-MM-DD'
    last_visit_date VARCHAR(50) DEFAULT 'N/A',
    next_follow_up_date VARCHAR(50) DEFAULT 'N/A',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by VARCHAR(50) DEFAULT '',
    updated_by VARCHAR(50) DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patients_full_name ON patients(LOWER(full_name));
CREATE INDEX IF NOT EXISTS idx_patients_phone ON patients(phone);
CREATE INDEX IF NOT EXISTS idx_patients_status ON patients(status);
CREATE INDEX IF NOT EXISTS idx_patients_registered_date ON patients(registered_date);
CREATE INDEX IF NOT EXISTS idx_patients_next_follow_up ON patients(next_follow_up_date);
CREATE INDEX IF NOT EXISTS idx_patients_search ON patients(patient_id, LOWER(full_name), phone);

CREATE TRIGGER trg_patients_updated_at
BEFORE UPDATE ON patients
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 5. TABLE: clinical_records
-- Source: models/ClinicalRecord.ts
-- Deep longitudinal psychiatric, medical, family, and developmental records.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS clinical_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id VARCHAR(50) NOT NULL REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE CASCADE,
    psychiatric_history JSONB NOT NULL DEFAULT '{
        "presentingHistory": "",
        "previousTreatment": "",
        "previousDiagnoses": "",
        "hospitalizationHistory": "",
        "treatmentResponse": "",
        "relevantHistory": ""
    }'::jsonb,
    medical_history JSONB NOT NULL DEFAULT '{
        "chronicConditions": "",
        "surgeries": "",
        "neurologicalHistory": "",
        "currentPhysicalIllnesses": ""
    }'::jsonb,
    personal_history JSONB NOT NULL DEFAULT '{
        "birthPerinatal": "",
        "developmentalMilestones": "",
        "educationalHistory": "",
        "occupationalHistory": ""
    }'::jsonb,
    family_history JSONB NOT NULL DEFAULT '{
        "mentalHealthDisorders": "",
        "substanceMisuse": "",
        "completedSuicides": "",
        "familyStructure": ""
    }'::jsonb,
    social_history JSONB NOT NULL DEFAULT '{
        "livingSituation": "",
        "psychosocialStressors": "",
        "substanceUseProfile": {
            "alcohol": "",
            "tobacco": "",
            "illicit": ""
        },
        "legalHistory": ""
    }'::jsonb,
    mental_status_exam JSONB NOT NULL DEFAULT '{
        "appearance": "",
        "behavior": "",
        "speech": "",
        "mood": "",
        "affect": "",
        "thoughtContent": "",
        "thoughtProcess": "",
        "perception": "",
        "cognition": "",
        "insight": "",
        "judgment": ""
    }'::jsonb,
    risk_assessment JSONB NOT NULL DEFAULT '{
        "suicideRisk": "Low",
        "homicideRisk": "Low",
        "selfHarmRisk": "Low",
        "vulnerabilityRisk": "Low",
        "riskNotes": ""
    }'::jsonb,
    record_type VARCHAR(100) DEFAULT 'CLINICAL_RECORD',
    details JSONB DEFAULT '{}'::jsonb,
    author VARCHAR(150) DEFAULT 'System',
    created_by VARCHAR(150) DEFAULT 'System',
    updated_by VARCHAR(150) DEFAULT 'System',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_clinical_records_patient ON clinical_records(patient_id, created_at DESC);

CREATE TRIGGER trg_clinical_records_updated_at
BEFORE UPDATE ON clinical_records
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 6. TABLE: fee_categories
-- Source: models/FeeCategory.ts
-- Master catalog of clinic service charges.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS fee_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'FC-101'
    name VARCHAR(150) NOT NULL,
    default_fee NUMERIC(10, 2) NOT NULL CHECK (default_fee >= 0),
    amount NUMERIC(10, 2),
    description TEXT DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by VARCHAR(50) DEFAULT '',
    updated_by VARCHAR(50) DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_fee_categories_active ON fee_categories(is_active);

CREATE TRIGGER trg_fee_categories_updated_at
BEFORE UPDATE ON fee_categories
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 7. TABLE: consultations
-- Source: models/Consultation.ts
-- Psychiatric encounters, structured MSE, ICD-10 diagnoses, and medication plans.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS consultations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'CNS-101'
    patient_id VARCHAR(50) NOT NULL REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    patient_name VARCHAR(200) NOT NULL,
    doctor_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    doctor_name VARCHAR(150) NOT NULL,
    clinician_id VARCHAR(50),
    clinician_name VARCHAR(150),
    consultation_date VARCHAR(50) NOT NULL, -- 'YYYY-MM-DD'
    time VARCHAR(50) DEFAULT '10:00 AM',
    visit_type VARCHAR(150) DEFAULT 'Follow-up Consultation',
    presenting_complaint TEXT NOT NULL,
    clinical_observations TEXT NOT NULL,
    mental_status_exam JSONB DEFAULT '{
        "appearance": "",
        "behavior": "",
        "speech": "",
        "moodAndAffect": "",
        "thoughtProcess": "",
        "thoughtContent": "",
        "perception": "",
        "cognition": "",
        "insightAndJudgment": ""
    }'::jsonb,
    assessment TEXT NOT NULL,
    diagnosis JSONB NOT NULL DEFAULT '{
        "primaryICD": "",
        "primaryTitle": "",
        "secondaryICD": "",
        "secondaryTitle": ""
    }'::jsonb,
    diagnosis_primary_icd VARCHAR(50) GENERATED ALWAYS AS (diagnosis->>'primaryICD') STORED,
    diagnosis_primary_title VARCHAR(255) GENERATED ALWAYS AS (diagnosis->>'primaryTitle') STORED,
    treatment_plan TEXT NOT NULL,
    medications JSONB NOT NULL DEFAULT '[]'::jsonb,
    follow_up_date VARCHAR(50) DEFAULT '',
    notes TEXT DEFAULT '',
    follow_up_notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_consultations_patient_date ON consultations(patient_id, consultation_date DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_doctor_date ON consultations(doctor_id, consultation_date DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_date ON consultations(consultation_date);
CREATE INDEX IF NOT EXISTS idx_consultations_primary_icd ON consultations(diagnosis_primary_icd);

-- Trigger to sync clinicianId <-> doctorId on consultations
CREATE OR REPLACE FUNCTION sync_consultation_clinician_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.clinician_id IS NULL OR NEW.clinician_id = '' THEN
        NEW.clinician_id := NEW.doctor_id;
    END IF;
    IF NEW.clinician_name IS NULL OR NEW.clinician_name = '' THEN
        NEW.clinician_name := NEW.doctor_name;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consultations_sync_clinician
BEFORE INSERT OR UPDATE ON consultations
FOR EACH ROW EXECUTE FUNCTION sync_consultation_clinician_fields();

CREATE TRIGGER trg_consultations_updated_at
BEFORE UPDATE ON consultations
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 8. TABLE: prescriptions
-- Source: models/Prescription.ts
-- Clinical prescriptions with dosage, frequency, route, and refill parameters.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS prescriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'RX-901'
    patient_id VARCHAR(50) NOT NULL REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    patient_name VARCHAR(200) NOT NULL,
    patient_age INT DEFAULT 30,
    patient_gender VARCHAR(50) DEFAULT 'Other',
    doctor_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    doctor_name VARCHAR(150) NOT NULL,
    clinician_id VARCHAR(50),
    clinician_name VARCHAR(150),
    doctor_license VARCHAR(100) DEFAULT '',
    prescription_date VARCHAR(50) NOT NULL, -- 'YYYY-MM-DD'
    date_issued VARCHAR(50), -- 'YYYY-MM-DD'
    consultation_id VARCHAR(50) DEFAULT '',
    diagnosis TEXT NOT NULL,
    medications JSONB NOT NULL DEFAULT '[]'::jsonb,
    treatment_plan TEXT DEFAULT '',
    treatment_notes TEXT DEFAULT '',
    instructions TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    status VARCHAR(50) NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Completed', 'Discontinued')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_date ON prescriptions(patient_id, prescription_date DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor_date ON prescriptions(doctor_id, prescription_date DESC);
CREATE INDEX IF NOT EXISTS idx_prescriptions_status_date ON prescriptions(status, prescription_date DESC);

-- Trigger to sync clinician and duplicate date/treatment fields on prescriptions
CREATE OR REPLACE FUNCTION sync_prescription_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.clinician_id IS NULL OR NEW.clinician_id = '' THEN
        NEW.clinician_id := NEW.doctor_id;
    END IF;
    IF NEW.clinician_name IS NULL OR NEW.clinician_name = '' THEN
        NEW.clinician_name := NEW.doctor_name;
    END IF;
    IF NEW.date_issued IS NULL OR NEW.date_issued = '' THEN
        NEW.date_issued := NEW.prescription_date;
    END IF;
    IF NEW.treatment_notes IS NULL OR NEW.treatment_notes = '' THEN
        NEW.treatment_notes := NEW.treatment_plan;
    END IF;
    IF NEW.treatment_plan IS NULL OR NEW.treatment_plan = '' THEN
        NEW.treatment_plan := NEW.treatment_notes;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prescriptions_sync_fields
BEFORE INSERT OR UPDATE ON prescriptions
FOR EACH ROW EXECUTE FUNCTION sync_prescription_fields();

CREATE TRIGGER trg_prescriptions_updated_at
BEFORE UPDATE ON prescriptions
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 9. TABLE: appointments
-- Source: models/Appointment.ts
-- Scheduling, booking slots, rooms, and telemedicine links.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    appointment_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'APT-1001'
    patient_id VARCHAR(50) NOT NULL REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE CASCADE,
    patient_name VARCHAR(200) NOT NULL,
    patient_phone VARCHAR(50) DEFAULT '',
    doctor_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    doctor_name VARCHAR(150) NOT NULL,
    clinician_id VARCHAR(50) DEFAULT '',
    clinician_name VARCHAR(150) DEFAULT '',
    appointment_date VARCHAR(50) NOT NULL, -- 'YYYY-MM-DD'
    appointment_time VARCHAR(50) NOT NULL, -- 'HH:MM AM/PM'
    duration_minutes INT NOT NULL DEFAULT 45,
    appointment_type VARCHAR(150) NOT NULL,
    notes TEXT DEFAULT '',
    room VARCHAR(100) DEFAULT 'Consultation Suite 1',
    consultation_mode VARCHAR(50) DEFAULT 'In-Person',
    online_session_link TEXT DEFAULT '',
    status VARCHAR(50) NOT NULL DEFAULT 'Scheduled' CHECK (status IN (
        'Scheduled', 'Confirmed', 'In Progress', 'Completed', 'Cancelled', 'No Show',
        'SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
    )),
    created_by VARCHAR(50) DEFAULT '',
    updated_by VARCHAR(50) DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_appointments_doctor_date ON appointments(doctor_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_date ON appointments(patient_id, appointment_date);
CREATE INDEX IF NOT EXISTS idx_appointments_date_status ON appointments(appointment_date, status);

CREATE OR REPLACE FUNCTION sync_appointment_fields()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.clinician_id IS NULL OR NEW.clinician_id = '' THEN
        NEW.clinician_id := NEW.doctor_id;
    END IF;
    IF NEW.clinician_name IS NULL OR NEW.clinician_name = '' THEN
        NEW.clinician_name := NEW.doctor_name;
    END IF;
    IF (NEW.online_session_link IS NULL OR NEW.online_session_link = '') AND (
        LOWER(COALESCE(NEW.consultation_mode, '')) LIKE '%online%' OR 
        LOWER(COALESCE(NEW.consultation_mode, '')) LIKE '%tele%' OR 
        LOWER(COALESCE(NEW.appointment_type, '')) LIKE '%online%'
    ) THEN
        NEW.online_session_link := 'https://meet.vancepsychiatry.com/room/session-' || LOWER(COALESCE(NEW.appointment_id, 'apt'));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_appointments_sync_fields
BEFORE INSERT OR UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION sync_appointment_fields();

CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 10. TABLE: follow_ups
-- Source: models/FollowUp.ts
-- Follow-up queues, priority statuses, and assigned doctors.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    follow_up_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'FLP-301'
    patient_id VARCHAR(50) NOT NULL REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE CASCADE,
    patient_name VARCHAR(200) NOT NULL,
    phone VARCHAR(50) DEFAULT '',
    doctor_id VARCHAR(50) DEFAULT '',
    assigned_doctor VARCHAR(150) NOT NULL,
    consultation_id VARCHAR(50) DEFAULT '',
    last_consultation_date VARCHAR(50) DEFAULT 'N/A',
    follow_up_date VARCHAR(50) NOT NULL, -- 'YYYY-MM-DD'
    reason TEXT NOT NULL,
    priority VARCHAR(50) NOT NULL DEFAULT 'Routine' CHECK (priority IN ('Routine', 'High', 'Urgent')),
    status VARCHAR(50) NOT NULL DEFAULT 'Upcoming' CHECK (status IN ('Due', 'Upcoming', 'Completed', 'Overdue', 'DUE', 'UPCOMING', 'COMPLETED', 'OVERDUE')),
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_date_status ON follow_ups(follow_up_date, status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_patient ON follow_ups(patient_id);

CREATE TRIGGER trg_follow_ups_updated_at
BEFORE UPDATE ON follow_ups
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 11. TABLE: therapy_sessions
-- Source: models/TherapySession.ts
-- Psychotherapy documentation (CBT, psychodynamic), notes, and psychometrics.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS therapy_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'TS-701'
    patient_id VARCHAR(50) NOT NULL REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    patient_name VARCHAR(200) NOT NULL,
    therapist_id VARCHAR(50) NOT NULL REFERENCES users(user_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    therapist_name VARCHAR(150) NOT NULL,
    session_date VARCHAR(50) NOT NULL, -- 'YYYY-MM-DD'
    duration_minutes INT NOT NULL DEFAULT 50,
    session_type VARCHAR(150) NOT NULL,
    assessment TEXT DEFAULT '',
    counselling TEXT DEFAULT '',
    intervention TEXT DEFAULT '',
    progress_notes TEXT DEFAULT '',
    psychometrics TEXT DEFAULT '',
    lifestyle_interventions TEXT DEFAULT '',
    follow_up_plan TEXT DEFAULT '',
    follow_up_date VARCHAR(50) DEFAULT '',
    responsible_clinician VARCHAR(150) DEFAULT '',
    responsible_clinician_id VARCHAR(50) DEFAULT '',
    status VARCHAR(50) NOT NULL DEFAULT 'Completed' CHECK (status IN ('Completed', 'Scheduled', 'Draft')),
    created_by VARCHAR(50) DEFAULT '',
    updated_by VARCHAR(50) DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_therapy_sessions_patient ON therapy_sessions(patient_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_therapy_sessions_therapist ON therapy_sessions(therapist_id, session_date DESC);

CREATE TRIGGER trg_therapy_sessions_updated_at
BEFORE UPDATE ON therapy_sessions
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 12. TABLE: payments
-- Source: models/Payment.ts
-- Financial transactions, immutable receipts (RCP-YYYY-XXXX), and billing ledgers.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'PY-401'
    receipt_number VARCHAR(100) UNIQUE NOT NULL, -- e.g. 'RCP-2026-0001' (STRICTLY IMMUTABLE)
    patient_id VARCHAR(50) NOT NULL REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE RESTRICT,
    patient_name VARCHAR(200) NOT NULL,
    appointment_id VARCHAR(50) DEFAULT '',
    consultation_id VARCHAR(50) DEFAULT '',
    fee_category_id VARCHAR(50) REFERENCES fee_categories(category_id) ON UPDATE CASCADE ON DELETE SET NULL,
    service VARCHAR(255) NOT NULL,
    fee_category VARCHAR(100) DEFAULT 'Consultation',
    amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(50) NOT NULL DEFAULT 'Cash' CHECK (payment_method IN ('Cash', 'Bank', 'Other', 'Card', 'Online')),
    payment_status VARCHAR(50) NOT NULL DEFAULT 'Paid' CHECK (payment_status IN ('Paid', 'Pending', 'Partial', 'PAID', 'PENDING', 'PARTIAL')),
    date VARCHAR(50) NOT NULL, -- 'YYYY-MM-DD'
    payment_date VARCHAR(50) DEFAULT '',
    notes TEXT DEFAULT '',
    received_by VARCHAR(100) DEFAULT '',
    created_by VARCHAR(50) DEFAULT '',
    updated_by VARCHAR(50) DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payments_date_status ON payments(date, payment_status);
CREATE INDEX IF NOT EXISTS idx_payments_patient_date ON payments(patient_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_payments_receipt_number ON payments(receipt_number);

-- Security Trigger: Guarantee Strict Immutability of receipt_number
CREATE OR REPLACE FUNCTION enforce_immutable_receipt_number()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.receipt_number IS DISTINCT FROM NEW.receipt_number THEN
        RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: receipt_number is strictly immutable and cannot be changed (Old: %, New: %)',
            OLD.receipt_number, NEW.receipt_number;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_immutable_receipt
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION enforce_immutable_receipt_number();

CREATE TRIGGER trg_payments_updated_at
BEFORE UPDATE ON payments
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 13. TABLE: audit_logs
-- Source: models/AuditLog.ts
-- Non-blocking, tamper-evident audit record of all mutations.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    log_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'LOG-8910'
    timestamp VARCHAR(50) NOT NULL,
    user_id VARCHAR(50) NOT NULL,
    user_name VARCHAR(150) NOT NULL,
    user_role VARCHAR(50) NOT NULL,
    action VARCHAR(100) NOT NULL,
    module VARCHAR(100) NOT NULL,
    resource_type VARCHAR(100) DEFAULT '',
    resource_id VARCHAR(100) DEFAULT '',
    patient_ref VARCHAR(100) DEFAULT '',
    description TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs(module, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_patient_ref ON audit_logs(patient_ref);

-- ==============================================================================
-- 14. TABLE: backup_logs
-- Source: models/BackupLog.ts
-- Metadata for database exports and backup archives.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS backup_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backup_id VARCHAR(50) UNIQUE NOT NULL, -- e.g. 'BKP-101'
    timestamp VARCHAR(50) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size VARCHAR(50) NOT NULL,
    type VARCHAR(100) NOT NULL DEFAULT 'Full System' CHECK (type IN ('Full System', 'Patient Records', 'Financial & Billing', 'Audit Logs')),
    status VARCHAR(50) NOT NULL DEFAULT 'Completed' CHECK (status IN ('Completed', 'In Progress', 'Failed')),
    created_by_name VARCHAR(150) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_backup_logs_created_at ON backup_logs(created_at DESC);

-- ==============================================================================
-- 15. TABLE: clinic_settings
-- Source: models/ClinicSettings.ts
-- Singleton clinic metadata, operating hours, and consultation parameters.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS clinic_settings (
    id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- Enforces single row singleton pattern
    clinic_name VARCHAR(255) NOT NULL DEFAULT 'Neuro Psychiatry Clinic',
    department VARCHAR(150) NOT NULL DEFAULT 'Psychiatry',
    doctor_designation VARCHAR(150) NOT NULL DEFAULT 'HOD & Consultant Psychiatrist',
    education VARCHAR(150) NOT NULL DEFAULT 'MBBS, MCPS, FCPS, CHPE',
    practice_name VARCHAR(255) NOT NULL DEFAULT 'Neuro Psychiatry Clinic',
    tagline TEXT DEFAULT 'Psychiatry Department • HOD & Consultant Psychiatrist',
    doctor_name VARCHAR(150) NOT NULL DEFAULT 'DR SHAHAB MUHAMMAD',
    license_number VARCHAR(100) NOT NULL DEFAULT 'NY-MED-849201',
    phone VARCHAR(50) DEFAULT '+1 (555) 800-VANCE',
    email VARCHAR(255) DEFAULT 'appointments@vancepsychiatry.com',
    address TEXT DEFAULT '680 Fifth Avenue, Suite 1800, New York, NY 10019',
    working_days TEXT[] DEFAULT ARRAY['Monday', 'Wednesday', 'Friday'],
    clinic_start_time VARCHAR(20) DEFAULT '18:00',
    clinic_end_time VARCHAR(20) DEFAULT '20:00',
    appointment_duration INT DEFAULT 45,
    break_start_time VARCHAR(20) DEFAULT '',
    break_end_time VARCHAR(20) DEFAULT '',
    notify_email BOOLEAN DEFAULT true,
    notify_sms BOOLEAN DEFAULT true,
    auto_remind_24h BOOLEAN DEFAULT true,
    operating_hours VARCHAR(150) DEFAULT 'Mon - Sat: 09:00 AM - 08:00 PM',
    consultation_fee NUMERIC(10, 2) DEFAULT 250.00,
    session_duration_minutes INT DEFAULT 45,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER trg_clinic_settings_updated_at
BEFORE UPDATE ON clinic_settings
FOR EACH ROW EXECUTE FUNCTION update_timestamp_column();

-- ==============================================================================
-- 16. SEED SINGLETON: Initial Clinic Settings
-- Ensures clinic settings row exists if empty
-- ==============================================================================
INSERT INTO clinic_settings (id, clinic_name, doctor_name)
VALUES (1, 'Neuro Psychiatry Clinic', 'DR SHAHAB MUHAMMAD')
ON CONFLICT (id) DO NOTHING;
