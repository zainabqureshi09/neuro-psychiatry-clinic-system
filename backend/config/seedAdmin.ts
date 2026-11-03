import { logger } from "../utils/logger";
import { countUsers, createUser } from "../../lib/db/repositories/userRepository";

type PermissionMatrix = {
  canWriteClinicalNotes: boolean;
  canPrescribe: boolean;
  canManagePatients: boolean;
  canManageAppointments: boolean;
  canManageUsers: boolean;
  canViewReports: boolean;
};

const PERMISSIONS: Record<string, PermissionMatrix> = {
  ADMIN: {
    canWriteClinicalNotes: true,
    canPrescribe: true,
    canManagePatients: true,
    canManageAppointments: true,
    canManageUsers: true,
    canViewReports: true,
  },
  DOCTOR: {
    canWriteClinicalNotes: true,
    canPrescribe: true,
    canManagePatients: true,
    canManageAppointments: true,
    canManageUsers: false,
    canViewReports: true,
  },
  RECEPTION: {
    canWriteClinicalNotes: false,
    canPrescribe: false,
    canManagePatients: true,
    canManageAppointments: true,
    canManageUsers: false,
    canViewReports: false,
  },
  THERAPIST: {
    canWriteClinicalNotes: true,
    canPrescribe: false,
    canManagePatients: true,
    canManageAppointments: true,
    canManageUsers: false,
    canViewReports: false,
  },
};

/**
 * Seeds initial staff accounts if the database contains no users.
 * Passwords are bcrypt-hashed by the user repository (never stored in plaintext).
 */
export const seedDefaultAdmin = async (): Promise<void> => {
  try {
    const count = await countUsers();
    if (count > 0) {
      return;
    }

    const isProd = process.env.NODE_ENV === "production";

    if (isProd) {
      const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
      const adminPass = process.env.INITIAL_ADMIN_PASSWORD;

      if (adminEmail && adminPass) {
        await createUser({
          userId: "USR-001",
          name: "Clinic Administrator",
          email: adminEmail,
          password: adminPass,
          role: "ADMIN",
          title: "System Administrator",
          department: "Administration",
          permissions: PERMISSIONS.ADMIN,
        });
        logger.info(`Production initial admin account created for '${adminEmail}'.`);
      } else {
        logger.warn(
          "NOTICE: Production database contains zero staff accounts. Provide INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD in environment variables to bootstrap an admin account."
        );
      }
      return;
    }

    const defaultStaff = [
      {
        userId: "USR-001",
        name: "Clinic Administrator",
        email: process.env.INITIAL_ADMIN_EMAIL || "admin@clinic.com",
        password: process.env.INITIAL_ADMIN_PASSWORD || "Admin@123456",
        role: "ADMIN" as const,
        title: "System Administrator",
        department: "Administration",
      },
      {
        userId: "USR-002",
        name: "Marcus Sterling",
        email: "m.sterling@vancepsychiatry.com",
        password: "Vance2026!",
        role: "ADMIN" as const,
        title: "Practice Director",
        department: "Administration",
      },
      {
        userId: "USR-003",
        name: "DR SHAHAB MUHAMMAD",
        email: "dr.vance@vancepsychiatry.com",
        password: "Vance2026!",
        role: "DOCTOR" as const,
        title: "HOD & Consultant Psychiatrist",
        department: "Psychiatry",
      },
      {
        userId: "USR-004",
        name: "Sarah Jenkins",
        email: "s.jenkins@vancepsychiatry.com",
        password: "Vance2026!",
        role: "RECEPTION" as const,
        title: "Clinical Coordinator",
        department: "Reception",
      },
      {
        userId: "USR-005",
        name: "Dr. Emily Watson, PsyD",
        email: "e.watson@vancepsychiatry.com",
        password: "Vance2026!",
        role: "THERAPIST" as const,
        title: "Senior Clinical Psychologist",
        department: "Psychotherapy",
      },
    ];

    for (const staff of defaultStaff) {
      await createUser({
        userId: staff.userId,
        name: staff.name,
        email: staff.email,
        password: staff.password,
        role: staff.role,
        title: staff.title,
        department: staff.department,
        permissions: PERMISSIONS[staff.role],
      });
    }

    logger.info("Default staff accounts bootstrapped successfully for ADMIN, DOCTOR, RECEPTION, and THERAPIST.");
  } catch (error: any) {
    logger.error("Error seeding default staff accounts:", error.message || error);
  }
};

