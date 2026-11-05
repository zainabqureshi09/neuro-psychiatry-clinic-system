import { Router } from "express";
import {
  getFeeCategories,
  createFeeCategory,
  updateFeeCategory,
  getPayments,
  getPaymentById,
  createPayment,
  updatePayment,
  getPaymentReceipt,
  getDailyCollectionReport,
  getMonthlyCollectionReport,
  getPracticeReports,
} from "../controllers/billingController";
import { authenticate, requireRole } from "../middleware/authMiddleware";
import { validateRequest } from "../middleware/validationMiddleware";
import {
  createFeeCategorySchema,
  updateFeeCategorySchema,
  createPaymentSchema,
  updatePaymentSchema,
} from "../utils/billingValidation";

const router = Router();

// Apply authentication to all billing routes
router.use(authenticate);

// Fee Category Routes
export const feeCategoryRouter = Router();
feeCategoryRouter.use(authenticate);

feeCategoryRouter.get(
  "/",
  requireRole("ADMIN", "DOCTOR", "RECEPTION", "THERAPIST"),
  getFeeCategories
);
feeCategoryRouter.post(
  "/",
  requireRole("ADMIN"),
  validateRequest(createFeeCategorySchema),
  createFeeCategory
);
feeCategoryRouter.put(
  "/:id",
  requireRole("ADMIN"),
  validateRequest(updateFeeCategorySchema),
  updateFeeCategory
);

// Payment Routes
export const paymentRouter = Router();
paymentRouter.use(authenticate);

paymentRouter.get(
  "/",
  requireRole("ADMIN", "DOCTOR", "RECEPTION"),
  getPayments
);
paymentRouter.get(
  "/:id",
  requireRole("ADMIN", "DOCTOR", "RECEPTION"),
  getPaymentById
);
paymentRouter.get(
  "/:id/receipt",
  requireRole("ADMIN", "DOCTOR", "RECEPTION"),
  getPaymentReceipt
);
paymentRouter.post(
  "/",
  requireRole("ADMIN", "RECEPTION"),
  validateRequest(createPaymentSchema),
  createPayment
);
paymentRouter.put(
  "/:id",
  requireRole("ADMIN", "RECEPTION"),
  validateRequest(updatePaymentSchema),
  updatePayment
);

// Collection Report Routes
export const reportRouter = Router();
reportRouter.use(authenticate);

// GET /api/reports - practice analytics (ADMIN + DOCTOR, mirrors the Next.js handler)
reportRouter.get(
  "/",
  requireRole("ADMIN", "DOCTOR"),
  getPracticeReports
);
reportRouter.get(
  "/collections/daily",
  requireRole("ADMIN", "DOCTOR", "RECEPTION"),
  getDailyCollectionReport
);
reportRouter.get(
  "/collections/monthly",
  requireRole("ADMIN", "DOCTOR", "RECEPTION"),
  getMonthlyCollectionReport
);

export default router;
