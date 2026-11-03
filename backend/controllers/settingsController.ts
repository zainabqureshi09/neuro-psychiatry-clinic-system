import { Request, Response, NextFunction } from 'express';
import { recordAuditEvent } from '../utils/auditLogger';
import {
  getClinicSettings,
  updateClinicSettings,
  ClinicSettingsRecord,
} from '../../lib/db/repositories/settingsRepository';

/**
 * GET /api/settings
 * Retrieve clinic profile & operating configuration.
 * Accessible to all authenticated staff members.
 */
export const getSettings = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const settings = await getClinicSettings();

    res.status(200).json({
      success: true,
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/settings
 * Admin-only update of clinic profile configuration.
 */
export const updateSettings = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const adminUser = req.user;

    const {
      clinicName,
      department,
      doctorDesignation,
      education,
      practiceName,
      tagline,
      doctorName,
      licenseNumber,
      phone,
      email,
      address,
      workingDays,
      clinicStartTime,
      clinicStart,
      clinicEndTime,
      clinicEnd,
      appointmentDuration,
      slotDurationMinutes,
      breakStartTime,
      breakStart,
      breakEndTime,
      breakEnd,
      notifyEmail,
      notifySMS,
      autoRemind24h,
    } = req.body;

    const updates: Partial<ClinicSettingsRecord> = {};

    if (clinicName !== undefined) updates.clinicName = String(clinicName).trim();
    if (department !== undefined) updates.department = String(department).trim();
    if (doctorDesignation !== undefined) updates.doctorDesignation = String(doctorDesignation).trim();
    if (education !== undefined) updates.education = String(education).trim();
    if (practiceName !== undefined) updates.practiceName = String(practiceName).trim();
    if (tagline !== undefined) updates.tagline = String(tagline).trim();
    if (doctorName !== undefined) updates.doctorName = String(doctorName).trim();
    if (licenseNumber !== undefined) updates.licenseNumber = String(licenseNumber).trim();
    if (phone !== undefined) updates.phone = String(phone).trim();
    if (email !== undefined) updates.email = String(email).trim();
    if (address !== undefined) updates.address = String(address).trim();
    if (workingDays !== undefined && Array.isArray(workingDays)) updates.workingDays = workingDays;

    if (clinicStartTime || clinicStart) updates.clinicStartTime = String(clinicStartTime || clinicStart).trim();
    if (clinicEndTime || clinicEnd) updates.clinicEndTime = String(clinicEndTime || clinicEnd).trim();

    if (appointmentDuration !== undefined || slotDurationMinutes !== undefined) {
      updates.appointmentDuration = Number(appointmentDuration ?? slotDurationMinutes);
    }

    if (breakStartTime !== undefined || breakStart !== undefined) {
      updates.breakStartTime = String(breakStartTime ?? breakStart ?? '').trim();
    }
    if (breakEndTime !== undefined || breakEnd !== undefined) {
      updates.breakEndTime = String(breakEndTime ?? breakEnd ?? '').trim();
    }

    if (notifyEmail !== undefined) updates.notifyEmail = Boolean(notifyEmail);
    if (notifySMS !== undefined) updates.notifySms = Boolean(notifySMS);
    if (autoRemind24h !== undefined) updates.autoRemind24h = Boolean(autoRemind24h);

    const settings = await updateClinicSettings(updates);

    // Log server-side audit event for settings update
    await recordAuditEvent({
      userId: adminUser?.userId || 'USR-ADMIN',
      userName: adminUser?.name || 'Administrator',
      userRole: adminUser?.role || 'ADMIN',
      action: 'UPDATE',
      module: 'SETTINGS',
      description: `Updated clinic profile configuration for '${settings.clinicName}'`,
    });

    res.status(200).json({
      success: true,
      message: 'Clinic configuration updated successfully.',
      data: settings,
    });
  } catch (error) {
    next(error);
  }
};
