import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";
import { recordAuditEvent } from "../utils/auditLogger";
import {
  getFeeCategories as getFeeCategoriesRepo,
  createFeeCategory as createFeeCategoryRepo,
  updateFeeCategory as updateFeeCategoryRepo,
  getPayments as getPaymentsRepo,
  getPaymentById as getPaymentRecord,
  recordPayment,
  updatePayment as updatePaymentRecord,
  getDailyFinancialReport,
  getMonthlyFinancialReport,
} from "../../lib/db/repositories/billingRepository";
import { getPatientById } from "../../lib/db/repositories/patientRepository";
import { getPracticeReport } from "../../lib/db/repositories/reportRepository";

/** Format a fee category for API responses. */
const formatFeeCategory = (category: any) => ({
  ...category,
  id: category.categoryId || category.id,
});

/** Format a payment for API responses. */
const formatPayment = (payment: any) => ({
  ...payment,
  id: payment.paymentId || payment.id,
});

// ==========================================
// FEE CATEGORY CONTROLLERS
// ==========================================

/**
 * GET /api/fee-categories
 */
export const getFeeCategories = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const categories = await getFeeCategoriesRepo();
    const formatted = categories.map(formatFeeCategory);

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error: any) {
    logger.error("Error fetching fee categories:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while fetching fee categories.",
    });
  }
};

/**
 * POST /api/fee-categories
 */
export const createFeeCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.userId;

    if (userRole !== "ADMIN") {
      res.status(403).json({
        success: false,
        error: "Access denied. Only system Administrators can configure fee categories.",
      });
      return;
    }

    const { name, defaultFee, amount, description, isActive } = req.body;
    const feeValue = Number(amount || defaultFee);

    if (isNaN(feeValue) || feeValue <= 0) {
      res.status(400).json({
        success: false,
        error: "Default fee amount must be a positive monetary value (> 0).",
      });
      return;
    }

    const existing = await getFeeCategoriesRepo();
    const categoryId = req.body.categoryId || req.body.id || `FEE-${100 + existing.length + 1}`;

    const newCategory = await createFeeCategoryRepo({
      categoryId,
      name,
      defaultFee: feeValue,
      amount: feeValue,
      description: description || "",
      isActive: isActive !== false,
      createdBy: userId,
      updatedBy: userId,
    });

    logger.info(`Created fee category '${name}' (${newCategory.categoryId}) by admin ${userId}`);

    await recordAuditEvent({
      userId: userId || "SYSTEM",
      userName: req.user?.name,
      userRole,
      action: "CREATE",
      module: "BILLING",
      resourceId: newCategory.categoryId,
      description: `Created fee category '${name}' (${newCategory.categoryId}) at ${feeValue}`,
    });

    res.status(201).json({
      success: true,
      message: `Fee category '${name}' created successfully.`,
      data: formatFeeCategory(newCategory),
    });
  } catch (error: any) {
    logger.error("Error creating fee category:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while creating fee category.",
    });
  }
};

/**
 * PUT /api/fee-categories/:id
 */
export const updateFeeCategory = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.userId;

    if (userRole !== "ADMIN") {
      res.status(403).json({
        success: false,
        error: "Access denied. Only system Administrators can modify fee categories.",
      });
      return;
    }

    const rawId = req.params.id;
    const targetId = Array.isArray(rawId) ? rawId[0] : (rawId as string);

    const categories = await getFeeCategoriesRepo();
    const category = categories.find((c) => c.categoryId === targetId);

    if (!category) {
      res.status(404).json({
        success: false,
        error: `Fee category '${targetId}' not found.`,
      });
      return;
    }

    const updates: Record<string, any> = { ...req.body };
    delete updates._id;
    delete updates.id;
    delete updates.categoryId;

    if (updates.defaultFee !== undefined || updates.amount !== undefined) {
      const feeVal = Number(updates.amount || updates.defaultFee);
      if (isNaN(feeVal) || feeVal <= 0) {
        res.status(400).json({
          success: false,
          error: "Fee amount must be a positive monetary value (> 0).",
        });
        return;
      }
      updates.defaultFee = feeVal;
      updates.amount = feeVal;
    }

    const updated =
      (await updateFeeCategoryRepo(category.categoryId, {
        ...updates,
        updatedBy: userId,
      })) || category;

    logger.info(`Updated fee category '${updated.name}' (${updated.categoryId})`);

    await recordAuditEvent({
      userId: userId || "SYSTEM",
      userName: req.user?.name,
      userRole,
      action: "UPDATE",
      module: "BILLING",
      resourceId: updated.categoryId,
      description: `Updated fee category '${updated.name}' (${updated.categoryId})`,
    });

    res.status(200).json({
      success: true,
      message: `Fee category '${updated.name}' updated successfully.`,
      data: formatFeeCategory(updated),
    });
  } catch (error: any) {
    logger.error("Error updating fee category:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while updating fee category.",
    });
  }
};


// ==========================================
// PAYMENT CONTROLLERS
// ==========================================

/**
 * GET /api/payments
 */
export const getPayments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { patientId, date, month, status } = req.query;
    const userRole = req.user?.role;

    // THERAPIST restriction
    if (userRole === "THERAPIST") {
      res.status(403).json({
        success: false,
        error: "Access denied. Therapists do not have access to financial administration records.",
      });
      return;
    }

    const payments = await getPaymentsRepo({
      patientId: patientId ? String(patientId) : undefined,
      date: date ? String(date) : undefined,
      month: month ? String(month) : undefined,
      status: status ? String(status) : undefined,
    });

    const formatted = payments.map(formatPayment);

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error: any) {
    logger.error("Error fetching payments:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while fetching payment records.",
    });
  }
};

/**
 * GET /api/payments/:id
 */
export const getPaymentById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userRole = req.user?.role;

    if (userRole === "THERAPIST") {
      res.status(403).json({
        success: false,
        error: "Access denied. Therapists do not have access to financial records.",
      });
      return;
    }

    const rawId = req.params.id;
    const targetId = Array.isArray(rawId) ? rawId[0] : (rawId as string);

    const payment = await getPaymentRecord(targetId);

    if (!payment) {
      res.status(404).json({
        success: false,
        error: `Payment record '${targetId}' not found.`,
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: formatPayment(payment),
    });
  } catch (error: any) {
    logger.error("Error fetching payment by ID:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while retrieving payment details.",
    });
  }
};

/**
 * GET /api/patients/:patientId/payments
 */
export const getPatientPayments = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { patientId } = req.params;
    const userRole = req.user?.role;

    if (userRole === "THERAPIST") {
      res.status(403).json({
        success: false,
        error: "Access denied. Therapists do not have access to financial records.",
      });
      return;
    }

    const patient = await getPatientById(String(patientId), { includeInactive: false });
    if (!patient) {
      res.status(404).json({
        success: false,
        error: `Patient with ID '${patientId}' not found.`,
      });
      return;
    }

    const payments = await getPaymentsRepo({ patientId: patient.patientId });
    const formatted = payments.map(formatPayment);

    res.status(200).json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error: any) {
    logger.error("Error fetching patient payments:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while fetching patient payment history.",
    });
  }
};


/**
 * POST /api/payments
 * Records an immutable receipt through the repository (atomic when a pg pool exists).
 */
export const createPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.userId;
    const userName = req.user?.name || "Staff";

    // Only ADMIN and RECEPTION can process payments
    if (userRole !== "ADMIN" && userRole !== "RECEPTION" && userRole !== "RECEPTIONIST") {
      res.status(403).json({
        success: false,
        error: "Access denied. Only Reception and Admin staff can process payments.",
      });
      return;
    }

    const { patientId, amount, service, feeCategory, feeCategoryId, paymentMethod, paymentStatus, notes, date } =
      req.body;

    if (!patientId) {
      res.status(400).json({
        success: false,
        error: "Patient ID is required to process a payment.",
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

    const paymentAmount = Number(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      res.status(400).json({
        success: false,
        error: "Payment amount must be a valid positive monetary value (> 0).",
      });
      return;
    }

    const paymentDate = date || new Date().toISOString().split("T")[0];

    const newPayment = await recordPayment({
      paymentId: req.body.paymentId || req.body.id,
      // Receipt numbers are generated server-side; client values cannot override them.
      receiptNumber: undefined,
      patientId: patient.patientId,
      patientName: patient.fullName,
      appointmentId: req.body.appointmentId,
      consultationId: req.body.consultationId,
      feeCategoryId,
      service: service || "Consultation Service",
      feeCategory: feeCategory || "Consultation",
      amount: paymentAmount,
      paymentMethod: paymentMethod || "Cash",
      paymentStatus: paymentStatus || "Paid",
      date: paymentDate,
      paymentDate,
      notes: notes || "",
      receivedBy: userName,
      createdBy: userId || "SYSTEM",
      updatedBy: userId || "SYSTEM",
    });

    await recordAuditEvent({
      userId: userId || "SYSTEM",
      userName,
      userRole,
      action: "CREATE",
      module: "BILLING",
      resourceId: newPayment.paymentId,
      patientRef: patient.patientId,
      description: `Processed payment ${newPayment.paymentId} (Receipt ${newPayment.receiptNumber}) for ${patient.fullName}`,
      metadata: { amount: paymentAmount, paymentMethod: newPayment.paymentMethod },
    });

    logger.info(
      `Processed payment ${newPayment.paymentId} (Receipt ${newPayment.receiptNumber}) for $${paymentAmount} by ${userName}`
    );

    res.status(201).json({
      success: true,
      message: `Payment of $${paymentAmount} processed. Receipt #${newPayment.receiptNumber} generated.`,
      data: formatPayment(newPayment),
    });
  } catch (error: any) {
    logger.error("Error processing payment:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while processing payment record.",
    });
  }
};

/**
 * PUT /api/payments/:id
 * Receipt numbers are strictly immutable and can never be altered.
 */
export const updatePayment = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.userId;

    if (userRole !== "ADMIN" && userRole !== "RECEPTION" && userRole !== "RECEPTIONIST") {
      res.status(403).json({
        success: false,
        error: "Access denied. Only Reception and Admin staff can update payment records.",
      });
      return;
    }

    const rawId = req.params.id;
    const targetId = Array.isArray(rawId) ? rawId[0] : (rawId as string);

    const existing = await getPaymentRecord(targetId);

    if (!existing) {
      res.status(404).json({
        success: false,
        error: `Payment record '${targetId}' not found.`,
      });
      return;
    }

    const updates: Record<string, any> = { ...req.body };
    delete updates._id;
    delete updates.id;
    delete updates.paymentId;
    delete updates.receiptNumber; // Receipt number is strictly immutable!

    if (updates.amount !== undefined) {
      const amtVal = Number(updates.amount);
      if (isNaN(amtVal) || amtVal <= 0) {
        res.status(400).json({
          success: false,
          error: "Payment amount must be a positive monetary value (> 0).",
        });
        return;
      }
      updates.amount = amtVal;
    }

    const payment = (await updatePaymentRecord(existing.paymentId, {
      ...updates,
      updatedBy: userId,
    })) || existing;

    await recordAuditEvent({
      userId: userId || "SYSTEM",
      userName: req.user?.name,
      userRole,
      action: "UPDATE",
      module: "BILLING",
      resourceId: payment.paymentId,
      patientRef: payment.patientId,
      description: `Updated payment record ${payment.paymentId} (Receipt ${payment.receiptNumber} preserved)`,
    });

    logger.info(`Updated payment record ${payment.paymentId} (Receipt ${payment.receiptNumber})`);

    res.status(200).json({
      success: true,
      message: `Payment record '${payment.paymentId}' updated.`,
      data: formatPayment(payment),
    });
  } catch (error: any) {
    logger.error("Error updating payment record:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while updating payment status.",
    });
  }
};

/**
 * GET /api/payments/:id/receipt
 * Generates the printable receipt payload from the stored, immutable record.
 */
export const getPaymentReceipt = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const rawId = req.params.id;
    const targetId = Array.isArray(rawId) ? rawId[0] : (rawId as string);

    const payment = await getPaymentRecord(targetId);

    if (!payment) {
      res.status(404).json({
        success: false,
        error: `Receipt record for ID '${targetId}' not found.`,
      });
      return;
    }

    const receiptPayload = {
      receiptNumber: payment.receiptNumber,
      paymentId: payment.paymentId,
      date: payment.date,
      clinic: {
        name: "Neuro Psychiatry Clinic",
        address: "680 Fifth Avenue, Suite 1800, New York, NY 10019",
        phone: "+1 (555) 800-VANCE",
        email: "billing@vancepsychiatry.com",
      },
      patient: {
        patientId: payment.patientId,
        patientName: payment.patientName,
      },
      service: payment.service,
      feeCategory: payment.feeCategory,
      amount: payment.amount,
      paymentMethod: payment.paymentMethod,
      paymentStatus: payment.paymentStatus,
      receivedBy: payment.receivedBy || "Clinic Coordinator",
      notes: payment.notes || "",
    };

    res.status(200).json({
      success: true,
      data: receiptPayload,
    });
  } catch (error: any) {
    logger.error("Error generating receipt payload:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while generating receipt document.",
    });
  }
};

// ==========================================
// COLLECTION REPORTS CONTROLLERS
// ==========================================

/**
 * GET /api/reports/collections/daily
 */
export const getDailyCollectionReport = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userRole = req.user?.role;
    if (userRole === "THERAPIST") {
      res.status(403).json({
        success: false,
        error: "Access denied. Therapists do not have access to financial collection reports.",
      });
      return;
    }

    const targetDate = (req.query.date as string) || new Date().toISOString().split("T")[0];
    const report = await getDailyFinancialReport(targetDate);

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    logger.error("Error calculating daily collection report:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while calculating daily collections.",
    });
  }
};

/**
 * GET /api/reports/collections/monthly
 */
export const getMonthlyCollectionReport = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userRole = req.user?.role;
    if (userRole === "THERAPIST") {
      res.status(403).json({
        success: false,
        error: "Access denied. Therapists do not have access to financial collection reports.",
      });
      return;
    }

    const current = new Date();
    const year = (req.query.year as string) || String(current.getFullYear());
    let month = (req.query.month as string) || String(current.getMonth() + 1).padStart(2, "0");

    if (month.length === 1) month = `0${month}`;

    const report = await getMonthlyFinancialReport(year, month);

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    logger.error("Error calculating monthly collection report:", error.message || error);
    res.status(500).json({
      success: false,
      error: "Internal server error while calculating monthly collections.",
    });
  }
};


// ==========================================
// PRACTICE ANALYTICS CONTROLLER
// ==========================================

/**
 * GET /api/reports
 *
 * Practice analytics aggregates (patient totals, appointment counts, revenue).
 * Mirrors the Next.js `/api/reports` handler exactly - same repository, same
 * role gate (ADMIN + DOCTOR) - so the frontend can rely on Express as the
 * single authoritative API in production without any behaviour change.
 */
export const getPracticeReports = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const report = await getPracticeReport();

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error: any) {
    logger.error("Error generating practice reports:", error.message || error);
    next(error);
  }
};

