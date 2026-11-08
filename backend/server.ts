import express from "express";
import cors from "cors";
import { connectDatabase, disconnectDatabase, loadEnvIfMissing } from "./config/database";

// Ensure environment files (.env.production in prod, .env.local in dev) are loaded
// before reading ALLOWED_ORIGINS, HOST, or PORT.
loadEnvIfMissing();
import { seedDefaultAdmin } from "./config/seedAdmin";
import healthRoutes from "./routes/healthRoutes";
import authRoutes from "./routes/authRoutes";
import userRoutes from "./routes/userRoutes";
import patientRoutes from "./routes/patientRoutes";
import consultationRoutes from "./routes/consultationRoutes";
import prescriptionRoutes from "./routes/prescriptionRoutes";
import appointmentRoutes from "./routes/appointmentRoutes";
import therapyRoutes from "./routes/therapyRoutes";
import { feeCategoryRouter, paymentRouter, reportRouter } from "./routes/billingRoutes";
import auditRoutes from "./routes/auditRoutes";
import { securityHeaders, authRateLimiter, adminRateLimiter, generalRateLimiter } from "./middleware/securityMiddleware";
import backupRoutes from "./routes/backupRoutes";
import settingsRoutes from "./routes/settingsRoutes";
import { notFoundHandler, errorHandler } from "./middleware/errorMiddleware";
import { logger } from "./utils/logger";
import { getHealthStatus } from "./controllers/healthController";

const app = express();

// Apply security response headers across all HTTP requests
app.use(securityHeaders);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:3000', 'http://localhost:5000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5000', 'https://npcs.digital'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS Policy: Origin ${origin} is not allowed`));
  },
  credentials: true,
}));

// Set strict payload size limits to mitigate payload buffer exhaustion
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Root health check endpoint
app.get("/", getHealthStatus);

// Apply general API rate limiting
app.use("/api", generalRateLimiter);

// Specialized rate limiters for authentication & sensitive admin routes
app.use("/api/auth", authRateLimiter, authRoutes);
app.use("/api/users", adminRateLimiter, userRoutes);
app.use("/api/audit-logs", adminRateLimiter, auditRoutes);
app.use("/api/backup", adminRateLimiter, backupRoutes);

// General domain routes
app.use("/api", healthRoutes);
app.use("/api/patients", patientRoutes);
app.use("/api/consultations", consultationRoutes);
app.use("/api/prescriptions", prescriptionRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/therapy-sessions", therapyRoutes);
app.use("/api/therapy", therapyRoutes);
app.use("/api/fee-categories", feeCategoryRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/reports", reportRouter);
app.use("/api/settings", settingsRoutes);

// Error Handling Middleware
app.use(notFoundHandler);
app.use(errorHandler);

// Environment Configuration
const HOST = process.env.HOST || "0.0.0.0";
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

let server: ReturnType<typeof app.listen> | null = null;

// Graceful Shutdown Logic
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  if (server) {
    server.close(() => {
      logger.info("Express HTTP server closed.");
    });
  }

  try {
    await disconnectDatabase();
    logger.info("Graceful shutdown completed. Exiting process.");
    process.exit(0);
  } catch (err: any) {
    logger.error("Error during graceful database disconnection:", err.message || err);
    process.exit(1);
  }
};

// Start Server & Database Connection
const startServer = async () => {
  try {
    // Connect to MongoDB before accepting incoming HTTP requests
    await connectDatabase();

    // Bootstrap default admin account if DB is empty
    await seedDefaultAdmin();

    server = app.listen(PORT, HOST, () => {
      logger.info(`Psychiatry EMR Backend active & listening on http://${HOST}:${PORT}`);
    });
  } catch (error: any) {
    logger.error("Database connection failure during startup. Server startup aborted.", error.message || error);
    process.exit(1);
  }
};

// Listen for termination signals and uncaught exceptions
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception detected:", error.message || error);
  shutdown("uncaughtException");
});

process.on("unhandledRejection", (reason: any) => {
  logger.error("Unhandled Rejection detected:", reason?.message || reason);
  shutdown("unhandledRejection");
});

if (!process.env.SKIP_SERVER_START) {
  startServer();
}

export default app;