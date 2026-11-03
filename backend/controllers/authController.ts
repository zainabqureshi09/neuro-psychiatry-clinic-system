import { Request, Response, NextFunction } from "express";
import { generateToken, comparePassword } from "../utils/authUtils";
import { recordAuditEvent } from "../utils/auditLogger";
import {
  findUserByEmail,
  updateUser,
  UserRecord,
} from "../../lib/db/repositories/userRepository";
import { AuthenticatedUser } from "../middleware/authMiddleware";

export { createUser } from "./userController";

/** Public (hash-free) representation of a staff account. */
export const toPublicUser = (user: Omit<UserRecord, "passwordHash"> | UserRecord) => ({
  id: user.userId,
  userId: user.userId,
  name: user.name,
  email: user.email,
  role: user.role,
  phone: user.phone || "",
  avatar: user.avatar || "",
  title: user.title || "",
  department: user.department || "",
  permissions: user.permissions,
  isActive: user.isActive,
  status: user.isActive ? "ACTIVE" : "INACTIVE",
  lastActive: user.lastActive || "Never",
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

/**
 * POST /api/auth/login
 * Authenticates user credentials, generates JWT token, and sets HTTP-only cookie.
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    const user = await findUserByEmail(String(email || ""));

    if (!user) {
      await recordAuditEvent({
        userId: "ANONYMOUS",
        userName: "Unknown User",
        userRole: "GUEST",
        action: "LOGIN_FAILED",
        module: "AUTH",
        description: `Failed login attempt for non-existent email: ${email}`,
      });
      res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
      return;
    }

    if (!user.isActive) {
      await recordAuditEvent({
        userId: user.userId,
        userName: user.name,
        userRole: user.role,
        action: "LOGIN_BLOCKED",
        module: "AUTH",
        description: `Blocked login attempt for deactivated account ${user.userId} (${email})`,
      });
      res.status(403).json({
        success: false,
        error: "Account has been deactivated. Please contact clinic administrator.",
      });
      return;
    }

    const isMatch = await comparePassword(String(password || ""), user.passwordHash);
    if (!isMatch) {
      await recordAuditEvent({
        userId: user.userId,
        userName: user.name,
        userRole: user.role,
        action: "LOGIN_FAILED",
        module: "AUTH",
        description: `Failed login attempt (invalid password) for user ${user.userId} (${email})`,
      });
      res.status(401).json({
        success: false,
        error: "Invalid email or password.",
      });
      return;
    }

    // Update lastActive timestamp (non-blocking for the session itself)
    try {
      await updateUser(user.userId, { lastActive: new Date().toISOString() });
    } catch (updateError: any) {
      console.error("[Auth] Unable to update lastActive:", updateError?.message || updateError);
    }

    const token = await generateToken({
      id: user.userId,
      userId: user.userId,
      email: user.email,
      name: user.name,
      role: user.role,
    });

    // Set HTTP-only cookie
    res.cookie("psychiatrist_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: "/",
    });

    // Log server-side audit event for successful login
    await recordAuditEvent({
      userId: user.userId,
      userName: user.name,
      userRole: user.role,
      action: "LOGIN",
      module: "AUTH",
      description: `User ${user.name} (${user.userId}) logged in successfully.`,
    });

    const publicUser = toPublicUser(user);

    res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: publicUser,
      data: publicUser,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/auth/logout
 * Clears session cookie.
 */
export const logout = (req: Request, res: Response): void => {
  if (req.user) {
    recordAuditEvent({
      userId: req.user.userId,
      userName: req.user.name,
      userRole: req.user.role,
      action: "LOGOUT",
      module: "AUTH",
      description: `User ${req.user.name} (${req.user.userId}) logged out.`,
    });
  }

  res.clearCookie("psychiatrist_session", { path: "/" });
  res.status(200).json({
    success: true,
    message: "Logged out successfully.",
  });
};

/**
 * GET /api/auth/me
 * Returns currently authenticated user profile.
 */
export const getCurrentUser = (req: Request, res: Response): void => {
  const userJson = req.user ? toPublicUser(req.user as AuthenticatedUser) : null;
  res.status(200).json({
    success: true,
    data: userJson,
    user: userJson,
  });
};

