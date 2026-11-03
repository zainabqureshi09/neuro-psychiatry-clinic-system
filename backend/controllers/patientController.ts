import { Request, Response, NextFunction } from "express";
import { recordAuditEvent } from "../utils/auditLogger";
import {
  listPatients,
  getPatientById as getPatientRecord,
  createPatient as createPatientRecord,
  updatePatient as updatePatientRecord,
  softDeletePatient,
  findPatientConflict,
} from "../../lib/db/repositories/patientRepository";
import {
  getClinicalRecordsByPatientId,
  createClinicalRecord as createClinicalRecordEntry,
} from "../../lib/db/repositories/clinicalRecordRepository";

/**
 * Helper to calculate age from date of birth (YYYY-MM-DD)
 */
const calculateAge = (dobString: string): number => {
  if (!dobString) return 30;
  const today = new Date();
  const birthDate = new Date(dobString);
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age > 0 ? age : 0;
};

/**
 * GET /api/patients
 * Paginated list of active patients with search & filter support
 */
export const getPatients = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const search = (req.query.search || req.query.q || "").toString().trim();
    const gender = (req.query.gender || "").toString().trim();
    const status = (req.query.status || "").toString().trim();
    const page = Math.max(1, parseInt((req.query.page || "1").toString(), 10));
    const limit = Math.max(1, Math.min(100, parseInt((req.query.limit || "50").toString(), 10)));

    const result = await listPatients({
      search,
      gender,
      status,
      page,
      limit,
      includeInactive: false,
    });

    res.status(200).json({
      success: true,
      count: result.data.length,
      total: result.total,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit) || 1,
        total: result.total,
      },
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/patients/:id
 * Retrieve a single patient profile by patientId (e.g. PX-9401) or _id
 */
export const getPatientById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);

    const patient = await getPatientRecord(id, { includeInactive: false });

    if (!patient) {
      res.status(404).json({
        success: false,
        error: `Patient record not found for ID: ${id}`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: patient,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patients
 * Register a new patient
 */
export const createPatient = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const {
      fullName,
      dateOfBirth,
      gender,
      phone,
      email,
      address,
      status,
      emergencyContact,
      clinicalIntake,
    } = req.body;

    // Check duplicate phone or CNIC
    const existingPatient = await findPatientConflict(phone, req.body.cnic);
    if (existingPatient) {
      res.status(400).json({
        success: false,
        error: "A patient chart with this phone number or CNIC already exists.",
      });
      return;
    }

    const age = req.body.age !== undefined ? Number(req.body.age) : calculateAge(dateOfBirth);
    const registeredDate = new Date().toISOString().split("T")[0];
    const createdBy = req.user?.userId || req.user?.email || "SYSTEM";

    const newPatient = await createPatientRecord(
      {
        fullName: String(fullName).trim(),
        dateOfBirth,
        age,
        gender,
        phone: String(phone).trim(),
        email: email ? String(email).trim() : "",
        address: address ? String(address).trim() : "",
        emergencyContact: emergencyContact || { name: "", relationship: "", phone: "" },
        clinicalIntake: clinicalIntake || {
          presentingComplaint: "Initial intake.",
          psychiatricHistory: "No prior documented admissions.",
          currentMedications: "None.",
          allergies: "NKDA.",
          familyHistory: "Non-contributory.",
          riskAssessment: "Low",
        },
        status: status || "Active",
        registeredDate,
        lastVisitDate: "Pending Intake",
        nextFollowUpDate: "Not Scheduled",
        isActive: true,
        createdBy,
      },
      createdBy
    );

    await recordAuditEvent({
      userId: createdBy,
      userName: req.user?.name,
      userRole: req.user?.role,
      action: "CREATE",
      module: "PATIENTS",
      resourceId: newPatient.patientId,
      patientRef: newPatient.patientId,
      description: `Registered new patient ${newPatient.fullName} (${newPatient.patientId})`,
    });

    res.status(201).json({
      success: true,
      message: `Patient ${newPatient.fullName} registered successfully with ID ${newPatient.patientId}.`,
      data: newPatient,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/patients/:id
 * Update an existing patient record
 */
export const updatePatient = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);

    const patient = await getPatientRecord(id, { includeInactive: false });

    if (!patient) {
      res.status(404).json({
        success: false,
        error: `Patient record not found for ID: ${id}`,
      });
      return;
    }

    const {
      fullName,
      dateOfBirth,
      gender,
      phone,
      email,
      address,
      status,
      emergencyContact,
      clinicalIntake,
      lastVisitDate,
      nextFollowUpDate,
    } = req.body;

    const updates: Record<string, any> = {
      updatedBy: req.user?.userId || req.user?.email || "SYSTEM",
    };

    if (fullName) updates.fullName = String(fullName).trim();
    if (dateOfBirth) {
      updates.dateOfBirth = dateOfBirth;
      updates.age = calculateAge(dateOfBirth);
    }
    if (gender) updates.gender = gender;
    if (phone) updates.phone = String(phone).trim();
    if (email !== undefined) updates.email = String(email).trim();
    if (address !== undefined) updates.address = String(address).trim();
    if (status) updates.status = status;
    if (emergencyContact) {
      updates.emergencyContact = { ...(patient.emergencyContact || {}), ...emergencyContact };
    }
    if (clinicalIntake) {
      updates.clinicalIntake = { ...(patient.clinicalIntake || {}), ...clinicalIntake };
    }
    if (lastVisitDate) updates.lastVisitDate = lastVisitDate;
    if (nextFollowUpDate) updates.nextFollowUpDate = nextFollowUpDate;

    const updated = (await updatePatientRecord(patient.patientId, updates)) || { ...patient, ...updates };

    await recordAuditEvent({
      userId: req.user?.userId || "SYSTEM",
      userName: req.user?.name,
      userRole: req.user?.role,
      action: "UPDATE",
      module: "PATIENTS",
      resourceId: updated.patientId,
      patientRef: updated.patientId,
      description: `Updated chart details for patient ${updated.fullName} (${updated.patientId})`,
    });

    res.status(200).json({
      success: true,
      message: `Patient record ${updated.patientId} updated successfully.`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/patients/:id
 * Soft delete / deactivate patient record (clinical & billing history preserved)
 */
export const deletePatient = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id as string);

    const patient = await getPatientRecord(id, { includeInactive: false });

    if (!patient) {
      res.status(404).json({
        success: false,
        error: `Patient record not found for ID: ${id}`,
      });
      return;
    }

    const deactivated = await softDeletePatient(
      patient.patientId,
      req.user?.userId || req.user?.email || "SYSTEM"
    );

    if (!deactivated) {
      res.status(404).json({
        success: false,
        error: `Patient record not found for ID: ${id}`,
      });
      return;
    }

    await recordAuditEvent({
      userId: req.user?.userId || "SYSTEM",
      userName: req.user?.name,
      userRole: req.user?.role,
      action: "DELETE",
      module: "PATIENTS",
      resourceId: patient.patientId,
      patientRef: patient.patientId,
      description: `Deactivated patient record for ${patient.fullName} (${patient.patientId}); clinical and billing history preserved`,
    });

    res.status(200).json({
      success: true,
      message: `Patient ${patient.patientId} record deactivated successfully.`,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/patients/:patientId/clinical-records
 */
export const getClinicalRecords = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawPatientId = req.params.patientId || (req.query.patientId as string);
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : (rawPatientId as string);

    const records = await getClinicalRecordsByPatientId(patientId);

    res.status(200).json({
      success: true,
      count: records.length,
      data: records,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patients/:patientId/clinical-records
 */
export const createClinicalRecord = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawPatientId = req.params.patientId || req.body.patientId;
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : (rawPatientId as string);

    const { recordType, details, author } = req.body;

    const newRecord = await createClinicalRecordEntry({
      patientId,
      recordType: recordType || "CLINICAL_RECORD",
      details: details || req.body,
      author: author || req.user?.name || "System",
      createdBy: req.user?.userId || "SYSTEM",
    });

    await recordAuditEvent({
      userId: req.user?.userId || "SYSTEM",
      userName: req.user?.name,
      userRole: req.user?.role,
      action: "CREATE",
      module: "CLINICAL_RECORDS",
      resourceId: newRecord.id || patientId,
      patientRef: patientId,
      description: `Documented clinical record (${newRecord.recordType || "CLINICAL_RECORD"}) for patient ${patientId}`,
    });

    res.status(201).json({
      success: true,
      message: "Clinical record documented successfully.",
      data: newRecord,
    });
  } catch (error) {
    next(error);
  }
};
