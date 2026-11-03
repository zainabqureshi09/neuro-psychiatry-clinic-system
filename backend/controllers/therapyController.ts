import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { recordAuditEvent } from "../utils/auditLogger";
import {
  listTherapySessions,
  getTherapySessionById as getTherapySessionRecord,
  createTherapySession as createTherapySessionRecord,
  updateTherapySession as updateTherapySessionRecord,
} from "../../lib/db/repositories/therapyRepository";
import { getPatientById } from "../../lib/db/repositories/patientRepository";

const REDACTED = "[REDACTED — Sensitive Therapy Note]";

/**
 * Format a therapy session for API responses, redacting clinical notes for Reception.
 */
const formatTherapySession = (session: any, isReception = false) => {
  const formatted: Record<string, any> = {
    ...session,
    id: session.sessionId || session.id,
    sessionId: session.sessionId || session.id,
  };

  delete formatted._id;
  delete formatted.__v;

  if (isReception) {
    formatted.assessment = REDACTED;
    formatted.counselling = REDACTED;
    formatted.intervention = REDACTED;
    formatted.progressNotes = REDACTED;
    formatted.psychometrics = REDACTED;
    formatted.lifestyleInterventions = REDACTED;
    formatted.followUpPlan = REDACTED;
  }

  return formatted;
};

const isReceptionRole = (role?: string): boolean => role === "RECEPTION" || role === "RECEPTIONIST";

/**
 * GET /api/patients/:patientId/therapy-sessions
 * GET /api/therapy-sessions (optional query ?patientId=...)
 */
export const getPatientTherapySessions = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawPatientId = req.params.patientId || (req.query.patientId as string);
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : (rawPatientId as string);
    const userRole = req.user?.role;
    const userId = req.user?.userId;

    if (patientId) {
      const patient = await getPatientById(patientId, { includeInactive: false });
      if (!patient) {
        res.status(404).json({
          success: false,
          error: `Patient with ID '${patientId}' not found.`,
        });
        return;
      }
    }

    let sessions = await listTherapySessions({ patientId: patientId || undefined });

    // THERAPIST restriction: only sessions they own, or the actively viewed chart.
    if (userRole === "THERAPIST") {
      sessions = sessions.filter(
        (s) =>
          s.therapistId === userId ||
          s.responsibleClinicianId === userId ||
          s.createdBy === userId ||
          (patientId ? s.patientId === patientId : false)
      );
    }

    const isReception = isReceptionRole(userRole);

    res.status(200).json({
      success: true,
      count: sessions.length,
      data: sessions.map((s) => formatTherapySession(s, isReception)),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/patients/:patientId/therapy-sessions/:sessionId
 * GET /api/therapy-sessions/:sessionId
 */
export const getTherapySessionById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawId = req.params.sessionId || req.params.id;
    const sessionId = Array.isArray(rawId) ? rawId[0] : (rawId as string);
    const rawPatientId = req.params.patientId;
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : rawPatientId;

    if (patientId) {
      const patient = await getPatientById(patientId, { includeInactive: false });
      if (!patient) {
        res.status(404).json({
          success: false,
          error: `Patient with ID '${patientId}' not found.`,
        });
        return;
      }
    }

    const session = await getTherapySessionRecord(sessionId);

    if (!session || (patientId && session.patientId !== patientId)) {
      res.status(404).json({
        success: false,
        error: `Therapy session record '${sessionId}' not found.`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: formatTherapySession(session, isReceptionRole(req.user?.role)),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/patients/:patientId/therapy-sessions
 * POST /api/therapy-sessions
 */
export const createTherapySession = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.userId;
    const userName = req.user?.name;

    if (isReceptionRole(userRole)) {
      res.status(403).json({
        success: false,
        error: "Access denied. Reception staff cannot create or modify psychotherapy notes.",
      });
      return;
    }

    const rawPatientId = req.params.patientId || req.body.patientId;
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : (rawPatientId as string);

    if (!patientId) {
      res.status(400).json({
        success: false,
        error: "A patientId is required to document a therapy session.",
      });
      return;
    }

    const patient = await getPatientById(patientId, { includeInactive: false });
    if (!patient) {
      res.status(404).json({
        success: false,
        error: `Patient with ID '${patientId}' not found.`,
      });
      return;
    }

    const newSession = await createTherapySessionRecord({
      sessionId: req.body.sessionId,
      patientId: patient.patientId,
      patientName: patient.fullName,
      therapistId: req.body.therapistId || userId || "USR-001",
      therapistName: req.body.therapistName || userName || "Clinician",
      sessionDate: req.body.sessionDate || new Date().toISOString().split("T")[0],
      durationMinutes: req.body.durationMinutes || 50,
      sessionType: req.body.sessionType,
      assessment: req.body.assessment || "",
      counselling: req.body.counselling || "",
      intervention: req.body.intervention || "",
      progressNotes: req.body.progressNotes || "",
      psychometrics: req.body.psychometrics || "",
      lifestyleInterventions: req.body.lifestyleInterventions || "",
      followUpPlan: req.body.followUpPlan || "",
      followUpDate: req.body.followUpDate || "",
      responsibleClinician: req.body.responsibleClinician || userName || "",
      responsibleClinicianId: req.body.responsibleClinicianId || userId || "",
      status: req.body.status || "Completed",
      createdBy: userId || "SYSTEM",
    });

    logger.info(`Therapy session ${newSession.sessionId} logged for patient ${patient.patientId} by ${userName}`);

    await recordAuditEvent({
      userId: userId || "SYSTEM",
      userName,
      userRole,
      action: "CREATE",
      module: "THERAPY",
      resourceId: newSession.sessionId,
      patientRef: patient.patientId,
      description: `Documented psychotherapy session ${newSession.sessionId} for ${patient.fullName}`,
    });

    res.status(201).json({
      success: true,
      message: `Therapy session ${newSession.sessionId} recorded successfully.`,
      data: formatTherapySession(newSession, false),
    });
  } catch (error: any) {
    logger.error("Error creating therapy session:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while saving therapy session record.",
    });
  }
};

/**
 * PUT /api/patients/:patientId/therapy-sessions/:sessionId
 * PUT /api/therapy-sessions/:sessionId
 */
export const updateTherapySession = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.userId;

    if (isReceptionRole(userRole)) {
      res.status(403).json({
        success: false,
        error: "Access denied. Reception staff cannot create or modify psychotherapy notes.",
      });
      return;
    }

    const { patientId, sessionId } = req.params;
    const targetSessionId = sessionId || req.params.id;

    if (patientId) {
      const patient = await getPatientById(String(patientId), { includeInactive: false });
      if (!patient) {
        res.status(404).json({
          success: false,
          error: `Patient with ID '${patientId}' not found.`,
        });
        return;
      }
    }

    const targetSessionIdStr = Array.isArray(targetSessionId)
      ? targetSessionId[0]
      : (targetSessionId as string);

    const existingSession = await getTherapySessionRecord(targetSessionIdStr);

    if (!existingSession || (patientId && existingSession.patientId !== patientId)) {
      res.status(404).json({
        success: false,
        error: `Therapy session record '${targetSessionIdStr}' not found.`,
      });
      return;
    }

    // THERAPIST authorization check
    if (userRole === "THERAPIST") {
      const isOwner =
        existingSession.therapistId === userId ||
        existingSession.createdBy === userId ||
        existingSession.responsibleClinicianId === userId;

      if (!isOwner) {
        res.status(403).json({
          success: false,
          error: "Access denied. You can only modify therapy sessions assigned to you.",
        });
        return;
      }
    }

    const allowedUpdates = { ...req.body };
    delete allowedUpdates._id;
    delete allowedUpdates.id;
    delete allowedUpdates.sessionId;
    delete allowedUpdates.patientId;

    const updated =
      (await updateTherapySessionRecord(existingSession.sessionId, {
        ...allowedUpdates,
        updatedBy: userId,
      })) || existingSession;

    logger.info(`Therapy session ${updated.sessionId} updated by user ${userId}`);

    await recordAuditEvent({
      userId: userId || "SYSTEM",
      userName: req.user?.name,
      userRole,
      action: "UPDATE",
      module: "THERAPY",
      resourceId: updated.sessionId,
      patientRef: updated.patientId,
      description: `Updated psychotherapy session ${updated.sessionId}`,
    });

    res.status(200).json({
      success: true,
      message: `Therapy session ${updated.sessionId} updated successfully.`,
      data: formatTherapySession(updated, false),
    });
  } catch (error: any) {
    logger.error("Error updating therapy session:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while updating therapy session record.",
    });
  }
};

