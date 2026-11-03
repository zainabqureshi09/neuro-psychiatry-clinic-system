import { Request, Response, NextFunction } from "express";
import { recordAuditEvent } from "../utils/auditLogger";
import {
  listConsultations,
  getConsultationById as getConsultationRecord,
  updateConsultation as updateConsultationRecord,
} from "../../lib/db/repositories/consultationRepository";
import { createConsultationCascade } from "../../lib/db/repositories/consultationCascade";
import { getPatientById } from "../../lib/db/repositories/patientRepository";
import { getClinicSettings } from "../../lib/db/repositories/settingsRepository";

/**
 * Helper to sanitize sensitive clinical note fields for restricted roles (e.g. RECEPTION)
 */
const sanitizeForReception = (consultation: any) => {
  return {
    ...consultation,
    presentingComplaint: "[Restricted: Clinical Note Access Limited for Reception]",
    clinicalObservations: "[Restricted: Clinical Note Access Limited for Reception]",
    treatmentPlan: "[Restricted: Clinical Note Access Limited for Reception]",
    notes: "[Restricted: Clinical Note Access Limited for Reception]",
    followUpNotes: "[Restricted: Clinical Note Access Limited for Reception]",
    mentalStatusExam: {
      appearance: "[Restricted]",
      behavior: "[Restricted]",
      speech: "[Restricted]",
      moodAndAffect: "[Restricted]",
      thoughtProcess: "[Restricted]",
      thoughtContent: "[Restricted]",
      perception: "[Restricted]",
      cognition: "[Restricted]",
      insightAndJudgment: "[Restricted]",
    },
  };
};

const formatConsultation = (consultation: any) => ({
  ...consultation,
  id: consultation.consultationId,
  date: consultation.consultationDate,
});

/**
 * GET /api/patients/:patientId/consultations (and GET /api/consultations)
 * Retrieve chronological list of consultations for a patient
 */
export const getPatientConsultations = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawPatientId = req.params.patientId || (req.query.patientId as string);
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : (rawPatientId as string);

    let effectivePatientId: string | undefined;

    if (patientId) {
      const patient = await getPatientById(patientId);
      if (!patient) {
        res.status(404).json({
          success: false,
          error: `Patient record not found for ID: ${patientId}`,
        });
        return;
      }
      effectivePatientId = patient.patientId;
    }

    const consultations = await listConsultations({ patientId: effectivePatientId });

    const isReception = req.user?.role === "RECEPTION" || req.user?.role === "RECEPTIONIST";
    const data = consultations.map((c) => {
      const item = formatConsultation(c);
      return isReception ? sanitizeForReception(item) : item;
    });

    res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/patients/:patientId/consultations/:consultationId (and GET /api/consultations/:id)
 * Retrieve a specific consultation record
 */
export const getConsultationById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawConsultationId = req.params.consultationId || req.params.id;
    const consultationId = Array.isArray(rawConsultationId) ? rawConsultationId[0] : (rawConsultationId as string);

    const consultation = await getConsultationRecord(consultationId);

    if (!consultation) {
      res.status(404).json({
        success: false,
        error: `Consultation record not found for ID: ${consultationId}`,
      });
      return;
    }

    // Nested patient route must never disclose another chart's consultation.
    const rawPatientId = req.params.patientId;
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : rawPatientId;
    if (patientId && consultation.patientId !== patientId) {
      const patient = await getPatientById(patientId);
      if (!patient || patient.patientId !== consultation.patientId) {
        res.status(404).json({
          success: false,
          error: `Consultation record not found for ID: ${consultationId}`,
        });
        return;
      }
    }

    const isReception = req.user?.role === "RECEPTION" || req.user?.role === "RECEPTIONIST";
    const formatted = formatConsultation(consultation);

    res.status(200).json({
      success: true,
      data: isReception ? sanitizeForReception(formatted) : formatted,
    });
  } catch (error) {
    next(error);
  }
};


/**
 * POST /api/patients/:patientId/consultations (and POST /api/consultations)
 * Document a clinical consultation together with its derived prescription,
 * follow-up task and patient chart timestamps (atomic when a pg pool exists).
 */
export const createConsultation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawPatientId = req.params.patientId || req.body.patientId;
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : (rawPatientId as string);

    const patient = await getPatientById(patientId);

    if (!patient) {
      res.status(404).json({
        success: false,
        error: `Patient record not found for ID: ${patientId}`,
      });
      return;
    }

    const doctorId = req.user?.userId || req.body.doctorId || "USR-001";
    const doctorName = req.user?.name || req.body.doctorName || "DR SHAHAB MUHAMMAD";
    const settings = await getClinicSettings();

    const result = await createConsultationCascade({
      consultation: {
        consultationId: req.body.consultationId,
        patientId: patient.patientId,
        patientName: patient.fullName,
        doctorId,
        doctorName,
        clinicianId: doctorId,
        clinicianName: doctorName,
        consultationDate: req.body.consultationDate || req.body.date,
        time: req.body.time,
        visitType: req.body.visitType,
        presentingComplaint: req.body.presentingComplaint,
        clinicalObservations: req.body.clinicalObservations,
        mentalStatusExam: req.body.mentalStatusExam,
        assessment: req.body.assessment,
        diagnosis: req.body.diagnosis,
        treatmentPlan: req.body.treatmentPlan,
        medications: req.body.medications || [],
        followUpDate: req.body.followUpDate || "",
        followUpNotes: req.body.followUpNotes || "",
        notes: req.body.notes || "",
      },
      patient: {
        patientId: patient.patientId,
        fullName: patient.fullName,
        age: patient.age,
        gender: patient.gender,
        phone: patient.phone,
      },
      doctorLicense: settings.licenseNumber,
      actorId: doctorId,
    });

    await recordAuditEvent({
      userId: doctorId,
      userName: doctorName,
      userRole: req.user?.role,
      action: "CREATE",
      module: "CONSULTATION",
      resourceId: result.consultation.consultationId,
      patientRef: patient.patientId,
      description: `Documented clinical consultation ${result.consultation.consultationId} for ${patient.fullName}`,
      metadata: {
        prescriptionId: result.prescription?.prescriptionId,
        followUpId: result.followUp?.followUpId,
        transactional: result.transactional,
      },
    });

    res.status(201).json({
      success: true,
      message: `Consultation record ${result.consultation.consultationId} saved for patient ${patient.fullName}`,
      data: formatConsultation(result.consultation),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/patients/:patientId/consultations/:consultationId (and PUT /api/consultations/:id)
 * Update an existing consultation record (DOCTOR & ADMIN only)
 */
export const updateConsultation = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (req.user?.role === "RECEPTION" || req.user?.role === "RECEPTIONIST") {
      res.status(403).json({
        success: false,
        error: "Access denied. Reception staff are not authorized to update clinical consultations.",
      });
      return;
    }

    const rawConsultationId = req.params.consultationId || req.params.id;
    const consultationId = Array.isArray(rawConsultationId) ? rawConsultationId[0] : (rawConsultationId as string);

    const existing = await getConsultationRecord(consultationId);

    if (!existing) {
      res.status(404).json({
        success: false,
        error: `Consultation record not found for ID: ${consultationId}`,
      });
      return;
    }

    const allowedUpdates = [
      "presentingComplaint",
      "clinicalObservations",
      "mentalStatusExam",
      "assessment",
      "diagnosis",
      "treatmentPlan",
      "medications",
      "followUpDate",
      "followUpNotes",
      "notes",
      "visitType",
      "time",
      "consultationDate",
    ];

    const updates: Record<string, any> = {};
    allowedUpdates.forEach((key) => {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    });

    const consultation = (await updateConsultationRecord(existing.consultationId, updates)) || existing;

    await recordAuditEvent({
      userId: req.user?.userId || "SYSTEM",
      userName: req.user?.name,
      userRole: req.user?.role,
      action: "UPDATE",
      module: "CONSULTATION",
      resourceId: consultation.consultationId,
      patientRef: consultation.patientId,
      description: `Updated clinical consultation ${consultation.consultationId}`,
    });

    res.status(200).json({
      success: true,
      message: `Consultation record ${consultation.consultationId} updated successfully.`,
      data: formatConsultation(consultation),
    });
  } catch (error) {
    next(error);
  }
};
