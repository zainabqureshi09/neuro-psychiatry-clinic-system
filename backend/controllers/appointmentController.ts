import { Request, Response, NextFunction } from "express";
import { createAppointmentSchema, updateAppointmentSchema } from "../utils/appointmentValidation";
import { recordAuditEvent } from "../utils/auditLogger";
import {
  listAppointments,
  getAppointmentById as getAppointmentRecord,
  createAppointment as createAppointmentRecord,
  updateAppointment as updateAppointmentRecord,
  checkClinicianConflict,
  timeToMinutes,
} from "../../lib/db/repositories/appointmentRepository";
import { getPatientById } from "../../lib/db/repositories/patientRepository";
import { findUserById } from "../../lib/db/repositories/userRepository";

export { timeToMinutes, checkClinicianConflict };

/**
 * Helper to format appointment response for UI compatibility
 */
const formatAppointmentResponse = (appt: any) => ({
  ...appt,
  id: appt.appointmentId || appt.id,
  date: appt.appointmentDate || appt.date,
  time: appt.appointmentTime || appt.time,
  type: appt.appointmentType || appt.type,
});

/**
 * GET /api/appointments (and GET /api/patients/:patientId/appointments)
 * Retrieve appointment list with filtering
 */
export const getAppointments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawPatientId = req.params.patientId || (req.query.patientId as string);
    const patientIdParam = Array.isArray(rawPatientId) ? rawPatientId[0] : (rawPatientId as string);
    const dateParam = (req.query.date as string) || (req.query.appointmentDate as string);
    const startDateParam = req.query.startDate as string;
    const endDateParam = req.query.endDate as string;
    const clinicianParam =
      (req.query.clinicianId as string) || (req.query.doctorId as string) || (req.query.clinician as string);
    const statusParam = req.query.status as string;
    const typeParam = (req.query.type as string) || (req.query.appointmentType as string);
    const searchParam = req.query.search as string;

    let scopedPatientId: string | undefined;

    if (patientIdParam) {
      const patient = await getPatientById(patientIdParam);
      if (!patient) {
        res.status(404).json({
          success: false,
          error: `Patient record not found for ID: ${patientIdParam}`,
        });
        return;
      }
      scopedPatientId = patient.patientId;
    }

    const todayStr = new Date().toISOString().split("T")[0];
    const filter: Parameters<typeof listAppointments>[0] = {
      patientId: scopedPatientId,
      doctorId: clinicianParam || undefined,
      date: dateParam || undefined,
      startDate: startDateParam || undefined,
      endDate: endDateParam || undefined,
      type: typeParam || undefined,
      search: searchParam || undefined,
      status: statusParam && statusParam !== "Today" && statusParam !== "Upcoming" ? statusParam : undefined,
    };

    if (statusParam === "Today") {
      filter.date = todayStr;
    } else if (statusParam === "Upcoming") {
      filter.startDate = todayStr;
      filter.excludeStatuses = ["Completed", "COMPLETED", "Cancelled", "CANCELLED"];
    }

    // Role-based scoping for DOCTOR
    if (req.user?.role === "DOCTOR" && !filter.doctorId) {
      filter.doctorId = req.user.userId;
    }

    const appointments = await listAppointments(filter);

    res.status(200).json({
      success: true,
      count: appointments.length,
      data: appointments.map(formatAppointmentResponse),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/appointments/:id (and GET /api/patients/:patientId/appointments/:id)
 * Retrieve a specific appointment
 */
export const getAppointmentById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawId = req.params.id || req.params.appointmentId;
    const id = Array.isArray(rawId) ? rawId[0] : (rawId as string);

    const appt = await getAppointmentRecord(id);

    if (!appt) {
      res.status(404).json({
        success: false,
        error: `Appointment not found for ID: ${id}`,
      });
      return;
    }

    const rawPatientId = req.params.patientId;
    const patientId = Array.isArray(rawPatientId) ? rawPatientId[0] : rawPatientId;
    if (patientId && appt.patientId !== patientId) {
      const patient = await getPatientById(patientId);
      if (!patient || appt.patientId !== patient.patientId) {
        res.status(404).json({
          success: false,
          error: `Appointment ${id} does not belong to patient ${patientId}`,
        });
        return;
      }
    }

    res.status(200).json({
      success: true,
      data: formatAppointmentResponse(appt),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/appointments (and POST /api/patients/:patientId/appointments)
 * Book a new clinical appointment
 */
export const createAppointment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const parsed = createAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: `Validation error: ${parsed.error.issues[0].message}`,
      });
      return;
    }

    const data = parsed.data;
    const rawTargetPatientId = req.params.patientId || data.patientId;
    const targetPatientId = Array.isArray(rawTargetPatientId)
      ? rawTargetPatientId[0]
      : (rawTargetPatientId as string);

    const patient = await getPatientById(targetPatientId);

    if (!patient) {
      res.status(404).json({
        success: false,
        error: `Patient record not found for ID: ${targetPatientId}`,
      });
      return;
    }

    // Determine Doctor / Clinician details
    let doctorId = data.doctorId || data.clinicianId || req.user?.userId || "USR-001";
    let doctorName = data.doctorName || data.clinicianName || req.user?.name || "DR SHAHAB MUHAMMAD";

    const clinicianUser = await findUserById(doctorId);

    if (clinicianUser) {
      doctorId = clinicianUser.userId;
      doctorName = clinicianUser.name;
    } else if (data.doctorId || data.clinicianId) {
      // Preserve the legacy contract: an explicitly supplied but unknown
      // clinician identifier is rejected with 404 instead of silently coercing.
      res.status(404).json({
        success: false,
        error: `Clinician not found for ID: ${doctorId}`,
      });
      return;
    }

    const appointmentDate = data.appointmentDate;
    const appointmentTime = data.appointmentTime;
    const durationMinutes = data.durationMinutes || 45;

    const hasConflict = await checkClinicianConflict(
      doctorId,
      appointmentDate,
      appointmentTime,
      durationMinutes
    );

    if (hasConflict) {
      res.status(409).json({
        success: false,
        error: `Time slot conflict: Doctor ${doctorName} is already booked on ${appointmentDate} at ${appointmentTime}. Please select an open slot.`,
      });
      return;
    }

    const createdBy = req.user?.userId || req.user?.name || "RECEPTION";

    const newAppointment = await createAppointmentRecord({
      appointmentId: (data as any).appointmentId,
      patientId: patient.patientId,
      patientName: patient.fullName,
      patientPhone: patient.phone,
      doctorId,
      doctorName,
      clinicianId: doctorId,
      clinicianName: doctorName,
      appointmentDate,
      appointmentTime,
      durationMinutes,
      appointmentType: data.appointmentType || data.type || "Follow-up Consultation",
      notes: data.notes || "",
      room: data.room || "Consultation Suite 1",
      consultationMode: data.consultationMode || "In-Person",
      onlineSessionLink: data.onlineSessionLink || "",
      status: data.status || "Scheduled",
      createdBy,
    });

    await recordAuditEvent({
      userId: req.user?.userId || "SYSTEM",
      userName: req.user?.name,
      userRole: req.user?.role,
      action: "CREATE",
      module: "APPOINTMENT",
      resourceId: newAppointment.appointmentId,
      patientRef: patient.patientId,
      description: `Booked ${newAppointment.appointmentType} appointment ${newAppointment.appointmentId} for ${patient.fullName} on ${appointmentDate} at ${appointmentTime}`,
    });

    res.status(201).json({
      success: true,
      message: `Appointment ${newAppointment.appointmentId} confirmed for ${patient.fullName} on ${appointmentDate} at ${appointmentTime}.`,
      data: formatAppointmentResponse(newAppointment),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/appointments/:id (and PUT /api/patients/:patientId/appointments/:id)
 * Update status or reschedule an appointment
 */
export const updateAppointment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawId = req.params.id || req.params.appointmentId;
    const id = Array.isArray(rawId) ? rawId[0] : (rawId as string);

    const appt = await getAppointmentRecord(id);

    if (!appt) {
      res.status(404).json({
        success: false,
        error: `Appointment not found for ID: ${id}`,
      });
      return;
    }

    const parsed = updateAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: `Validation error: ${parsed.error.issues[0].message}`,
      });
      return;
    }

    const updates = req.body;
    const newDate = updates.appointmentDate || updates.date || appt.appointmentDate;
    const newTime = updates.appointmentTime || updates.time || appt.appointmentTime;
    const newDoctorId = updates.doctorId || updates.clinicianId || appt.doctorId;
    const newDuration = updates.durationMinutes || appt.durationMinutes;

    const isRescheduled =
      newDate !== appt.appointmentDate || newTime !== appt.appointmentTime || newDoctorId !== appt.doctorId;

    if (isRescheduled) {
      const hasConflict = await checkClinicianConflict(
        newDoctorId,
        newDate,
        newTime,
        newDuration,
        appt.appointmentId
      );

      if (hasConflict) {
        res.status(409).json({
          success: false,
          error: `Rescheduling conflict: Doctor ${updates.doctorName || appt.doctorName} is already booked on ${newDate} at ${newTime}.`,
        });
        return;
      }
    }

    const patch: Record<string, any> = {
      updatedBy: req.user?.userId || req.user?.name || "RECEPTION",
    };

    if (updates.appointmentDate || updates.date) patch.appointmentDate = newDate;
    if (updates.appointmentTime || updates.time) patch.appointmentTime = newTime;
    if (updates.durationMinutes) patch.durationMinutes = newDuration;
    if (updates.doctorId || updates.clinicianId) {
      patch.doctorId = newDoctorId;
      patch.clinicianId = newDoctorId;
    }
    if (updates.doctorName || updates.clinicianName) {
      patch.doctorName = updates.doctorName || updates.clinicianName;
      patch.clinicianName = patch.doctorName;
    }
    if (updates.appointmentType || updates.type) patch.appointmentType = updates.appointmentType || updates.type;
    if (updates.notes !== undefined) patch.notes = updates.notes;
    if (updates.room !== undefined) patch.room = updates.room;
    if (updates.consultationMode !== undefined) patch.consultationMode = updates.consultationMode;
    if (updates.onlineSessionLink !== undefined) patch.onlineSessionLink = updates.onlineSessionLink;
    if (updates.status) patch.status = updates.status;

    const updated = (await updateAppointmentRecord(appt.appointmentId, patch)) || { ...appt, ...patch };

    res.status(200).json({
      success: true,
      message: `Appointment ${updated.appointmentId} updated successfully.`,
      data: formatAppointmentResponse(updated),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/appointments/:id
 * Delete or soft-cancel an appointment
 */
export const deleteAppointment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawId = req.params.id || req.params.appointmentId;
    const id = Array.isArray(rawId) ? rawId[0] : (rawId as string);

    const appt = await getAppointmentRecord(id);

    if (!appt) {
      res.status(404).json({
        success: false,
        error: `Appointment not found for ID: ${id}`,
      });
      return;
    }

    // Appointments are cancelled rather than destroyed so scheduling history
    // (and any linked billing/audit records) remains intact.
    const cancelled =
      (await updateAppointmentRecord(appt.appointmentId, {
        status: "Cancelled",
        updatedBy: req.user?.userId || "SYSTEM",
      })) || { ...appt, status: "Cancelled" };

    await recordAuditEvent({
      userId: req.user?.userId || "SYSTEM",
      userName: req.user?.name,
      userRole: req.user?.role,
      action: "DELETE",
      module: "APPOINTMENT",
      resourceId: cancelled.appointmentId,
      patientRef: cancelled.patientId,
      description: `Cancelled appointment ${cancelled.appointmentId} for patient ${cancelled.patientName}`,
    });

    res.status(200).json({
      success: true,
      message: `Appointment ${cancelled.appointmentId} status changed to Cancelled.`,
      data: formatAppointmentResponse(cancelled),
    });
  } catch (error) {
    next(error);
  }
};
