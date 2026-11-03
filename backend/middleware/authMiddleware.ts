import { Request, Response, NextFunction } from "express";
import { verifyToken, TokenPayload } from "../utils/authUtils";
import { findUserById, UserRecord } from "../../lib/db/repositories/userRepository";
import { UserRole, IUserPermissions } from "../../models/User";

/**
 * Authenticated staff principal attached to Express requests.
 * The bcrypt hash is stripped before the object leaves the data layer.
 */
export type AuthenticatedUser = Omit<UserRecord, "passwordHash">;

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      tokenPayload?: TokenPayload;
    }
  }
}

/**
 * Extracts JWT token from Authorization header (Bearer token) or HTTP Cookies.
 */
const extractToken = (req: Request): string | null => {
  // 1. Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token) return token;
  }

  // 2. Cookie: psychiatrist_session=<token>
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(";").reduce((acc, cookie) => {
      const [key, val] = cookie.trim().split("=");
      if (key && val) acc[key] = decodeURIComponent(val);
      return acc;
    }, {} as Record<string, string>);

    if (cookies["psychiatrist_session"]) return cookies["psychiatrist_session"];
    if (cookies["token"]) return cookies["token"];
  }

  return null;
};

/**
 * Authentication Middleware: Verifies the custom JWT and attaches the staff
 * account resolved through the repository layer (PostgreSQL or MongoDB).
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({
        success: false,
        error: "Authentication required. Please provide a valid bearer token or session cookie.",
      });
      return;
    }

    const payload = await verifyToken(token);
    if (!payload) {
      res.status(401).json({
        success: false,
        error: "Invalid or expired authentication token.",
      });
      return;
    }

    const user = await findUserById(payload.userId || payload.id);

    if (!user) {
      res.status(401).json({
        success: false,
        error: "User account associated with this token no longer exists.",
      });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({
        success: false,
        error: "User account has been deactivated. Access denied.",
      });
      return;
    }

    const { passwordHash, ...safeUser } = user;
    req.user = safeUser;
    req.tokenPayload = payload;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Role-Based Authorization Middleware: Checks if req.user has one of the allowed roles.
 */
export const requireRole = (...allowedRoles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: "Authentication required prior to authorization check.",
      });
      return;
    }

    const userRole = req.user.role;

    // Normalize RECEPTION / RECEPTIONIST equivalent roles
    const isAuthorized = allowedRoles.some((role) => {
      if (role === "RECEPTION" && userRole === "RECEPTIONIST") return true;
      if (role === "RECEPTIONIST" && userRole === "RECEPTION") return true;
      return role === userRole;
    });

    if (!isAuthorized) {
      res.status(403).json({
        success: false,
        error: `Access denied. Authorized roles: [${allowedRoles.join(", ")}]. Current role: '${userRole}'.`,
      });
      return;
    }

    next();
  };
};

/**
 * Granular Permission Authorization Middleware: Checks a specific permission flag.
 */
export const requirePermission = (permissionKey: keyof IUserPermissions) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: "Authentication required prior to permission check.",
      });
      return;
    }

    // ADMIN role overrides permission checks
    if (req.user.role === "ADMIN") {
      next();
      return;
    }

    const hasPermission = Boolean(req.user.permissions && req.user.permissions[permissionKey]);
    if (!hasPermission) {
      res.status(403).json({
        success: false,
        error: `Access denied. Account lacks required permission '${String(permissionKey)}'.`,
      });
      return;
    }

    next();
  };
};

