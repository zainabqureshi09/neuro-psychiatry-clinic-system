import { Request, Response } from "express";
import { getBackendDatabaseHealth } from "../config/database";

export const getHealthStatus = async (_req: Request, res: Response): Promise<void> => {
  const database = await getBackendDatabaseHealth();

  res.status(200).json({
    success: true,
    message: "Psychiatry EMR Backend is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    database: {
      provider: database.provider,
      status: database.status,
      ready: database.ready,
      transactions: database.transactions,
    },
  });
};

