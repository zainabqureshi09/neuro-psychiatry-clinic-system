import { Request, Response, NextFunction } from "express";
import { recordAuditEvent } from "../utils/auditLogger";
import {
  listPrescriptions,
  getPrescriptionById as getPrescriptionRecord,
  createPrescription as createPrescriptionRecord,
  updatePrescription as updatePrescriptionRecord,
} from "../../lib/db/repositories/prescriptionRepository";
import { getPatientById } from "../../lib/db/repositories/patientRepository";
import { getClinicSettings } from "../../lib/db/repositories/settingsRepository";

/**
 * Helper to sanitize clinical prescription details for RECEPTION role
 */
const sanitizeForReception = (rx: any) => {
  return {
    ...rx,
    treatmentNotes: "[Restricted: Clinical Note Access Limited for Reception]",
    treatmentPlan: "[Restricted: Clinical Note Access Limited for Reception]",
    instructions: "[Restricted: Clinical Note Access Limited for Reception]",
    medications: rx.medications?.map((m: any) => ({
      ...m,
      instructions: "[Restricted for Reception]",
    })),
  };
};

const formatPrescription = (rx: any) => ({
  ...rx,
  id: rx.prescriptionId,
  dateIssued: rx.prescriptionDate || rx.dateIssued,
});

/**
 * GET /api/patients/:patientId/prescriptions (and GET /api/prescriptions)
 * Retrieve prescription history for a patient
 */
export const getPatientPrescriptions = async (
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

    const prescriptions = await listPrescriptions({ patientId: effectivePatientId });

    const isReception = req.user?.role === "RECEPTION" || req.user?.role === "RECEPTIONIST";
    const data = prescriptions.map((r) => {
      const item = formatPrescription(r);
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
 * GET /api/patients/:patientId/prescriptions/:prescriptionId (and GET /api/prescriptions/:id)
 * Retrieve a specific prescription record
 */
export const getPrescriptionById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawParam = req.params.prescriptionId || req.params.id;
    const prescriptionId = Array.isArray(rawParam) ? rawParam[0] : (rawParam as string);

    const rx = await getPrescriptionRecord(prescriptionId);

    if (!rx) {
      res.status(404).json({
        success: false,
        error: `Prescription record not found for ID: ${prescriptionId}`,
      });
      return;
    }

    const rawPatientId = req.params.patientId;
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : rawPatientId;
    if (patientId && rx.patientId !== patientId) {
      const patient = await getPatientById(patientId);
      if (!patient || patient.patientId !== rx.patientId) {
        res.status(404).json({
          success: false,
          error: `Prescription record not found for ID: ${prescriptionId}`,
        });
        return;
      }
    }

    const isReception = req.user?.role === "RECEPTION" || req.user?.role === "RECEPTIONIST";
    const formatted = formatPrescription(rx);

    res.status(200).json({
      success: true,
      data: isReception ? sanitizeForReception(formatted) : formatted,
    });
  } catch (error) {
    next(error);
  }
};


/**
 * POST /api/patients/:patientId/prescriptions (and POST /api/prescriptions)
 * Issue a new prescription for a patient.
 */
export const createPrescription = async (
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

    const settings = await getClinicSettings();
    const doctorId = req.user?.userId || req.body.doctorId || "USR-001";
    const doctorName = req.user?.name || req.body.doctorName || "DR SHAHAB MUHAMMAD";
    const prescriptionDate =
      req.body.prescriptionDate || req.body.dateIssued || new Date().toISOString().split("T")[0];

    const newPrescription = await createPrescriptionRecord({
      prescriptionId: req.body.prescriptionId,
      patientId: patient.patientId,
      patientName: patient.fullName,
      patientAge: patient.age,
      patientGender: patient.gender,
      doctorId,
      doctorName,
      clinicianId: doctorId,
      clinicianName: doctorName,
      doctorLicense: req.body.doctorLicense || settings.licenseNumber || "NY-MED-849201",
      prescriptionDate,
      dateIssued: prescriptionDate,
      diagnosis: req.body.diagnosis,
      medications: req.body.medications || [],
      treatmentPlan: req.body.treatmentPlan || req.body.treatmentNotes || "",
      treatmentNotes: req.body.treatmentNotes || req.body.treatmentPlan || "",
      instructions: req.body.instructions,
      notes: req.body.notes,
      status: req.body.status || "Active",
    });

    await recordAuditEvent({
      userId: doctorId,
      userName: doctorName,
      userRole: req.user?.role,
      action: "CREATE",
      module: "PRESCRIPTION",
      resourceId: newPrescription.prescriptionId,
      patientRef: patient.patientId,
      description: `Issued digital prescription ${newPrescription.prescriptionId} for ${patient.fullName}`,
    });

    res.status(201).json({
      success: true,
      message: `Prescription ${newPrescription.prescriptionId} issued successfully for ${patient.fullName}.`,
      data: formatPrescription(newPrescription),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/patients/:patientId/prescriptions/:prescriptionId (and PUT /api/prescriptions/:id)
 * Update an existing prescription record (identifiers are immutable).
 */
export const updatePrescription = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawParam = req.params.prescriptionId || req.params.id;
    const prescriptionId = Array.isArray(rawParam) ? rawParam[0] : (rawParam as string);

    const existing = await getPrescriptionRecord(prescriptionId);

    if (!existing) {
      res.status(404).json({
        success: false,
        error: `Prescription record not found for ID: ${prescriptionId}`,
      });
      return;
    }

    const allowedUpdates = [
      "diagnosis",
      "medications",
      "treatmentNotes",
      "treatmentPlan",
      "instructions",
      "status",
      "prescriptionDate",
      "dateIssued",
    ];

    const updates: Record<string, any> = {};
    allowedUpdates.forEach((key) => {
      if (req.body[key] !== undefined) {
        updates[key] = req.body[key];
      }
    });

    const rx = (await updatePrescriptionRecord(existing.prescriptionId, updates)) || existing;

    await recordAuditEvent({
      userId: req.user?.userId || "SYSTEM",
      userName: req.user?.name,
      userRole: req.user?.role,
      action: "UPDATE",
      module: "PRESCRIPTION",
      resourceId: rx.prescriptionId,
      patientRef: rx.patientId,
      description: `Updated prescription ${rx.prescriptionId}`,
    });

    res.status(200).json({
      success: true,
      message: `Prescription ${rx.prescriptionId} updated successfully.`,
      data: formatPrescription(rx),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patients/:patientId/prescriptions/:id/reuse (and POST /api/prescriptions/:id/reuse)
 * Reissues an existing prescription as a NEW prescription record
 */
export const reusePrescription = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (req.user?.role === "RECEPTION" || req.user?.role === "RECEPTIONIST" || req.user?.role === "THERAPIST") {
      res.status(403).json({
        success: false,
        error: "Access denied. Only licensed physicians are authorized to reissue prescriptions.",
      });
      return;
    }

    const rawId = req.params.prescriptionId || req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : (rawId as string);

    const originalRx = await getPrescriptionRecord(id);

    if (!originalRx) {
      res.status(404).json({
        success: false,
        error: `Original prescription '${id}' not found for reuse.`,
      });
      return;
    }

    const reissued = await createPrescriptionRecord({
      patientId: originalRx.patientId,
      patientName: originalRx.patientName,
      patientAge: originalRx.patientAge,
      patientGender: originalRx.patientGender,
      doctorId: req.user?.userId || originalRx.doctorId,
      doctorName: req.user?.name || originalRx.doctorName,
      doctorLicense: originalRx.doctorLicense,
      prescriptionDate: new Date().toISOString().split("T")[0],
      diagnosis: originalRx.diagnosis,
      medications: originalRx.medications,
      treatmentPlan: originalRx.treatmentPlan,
      notes: `Reissued from ${originalRx.prescriptionId}. ${originalRx.notes || ""}`.trim(),
      status: "Active",
      createdBy: req.user?.userId || req.user?.name || "DOCTOR",
    });

    await recordAuditEvent({
      userId: req.user?.userId || "SYSTEM",
      userName: req.user?.name,
      userRole: req.user?.role,
      action: "CREATE",
      module: "PRESCRIPTION",
      resourceId: reissued.prescriptionId,
      patientRef: originalRx.patientId,
      description: `Reissued digital prescription ${reissued.prescriptionId} (from ${originalRx.prescriptionId}) for ${originalRx.patientName}`,
    });

    res.status(201).json({
      success: true,
      message: `Prescription reissued successfully as ${reissued.prescriptionId}.`,
      data: formatPrescription(reissued),
    });
  } catch (error) {
    next(error);
  }
};
