import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { cookies, headers } from 'next/headers';
import { UserRole } from '@/models/User';

const COOKIE_NAME = 'psychiatrist_session';

/** Insecure placeholder secrets that must never be accepted in production. */
const PLACEHOLDER_SECRET_MARKERS = [
  'psychiatrist_system_secure',
  'your-32-character',
  'your_secure',
  'secure_jwt',
  '<GENERATE',
  'placeholder',
];

/**
 * Resolves the signing secret lazily so that tests and runtime environment
 * changes are always respected (and production misconfiguration is caught).
 *
 * Mirrors backend/utils/authUtils.ts: in production a real secret is mandatory.
 * Failing loudly is intentional - silently signing sessions with a hardcoded
 * development secret would let anyone forge an ADMIN token.
 */
function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    const isUsable =
      Boolean(secret) &&
      secret!.length >= 32 &&
      !PLACEHOLDER_SECRET_MARKERS.some((marker) => secret!.includes(marker));

    if (!isUsable) {
      throw new Error(
        'FATAL SECURITY ERROR: SESSION_SECRET must be a unique value of at least 32 characters in production.'
      );
    }
  }

  const activeSecret = secret || 'psychiatrist_system_secure_jwt_session_secret_32chars_min';
  return new TextEncoder().encode(activeSecret);
}

export interface SessionPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  exp?: number;
}

/**
 * Hash a plain text password using bcrypt
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Verify a plain text password against a stored bcrypt hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Create a JWT token and store it in an HTTP-only cookie
 */
export async function createSessionCookie(payload: Omit<SessionPayload, 'exp'>): Promise<string> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1d') // Session expires in 24 hours
    .sign(getSecretKey());

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 1 day
  });

  return token;
}

/**
 * Get and verify the current session payload from HTTP-only cookie, Authorization header, or Request object
 */
export async function getSession(req?: Request): Promise<SessionPayload | null> {
  try {
    let token: string | undefined | null = null;

    if (req) {
      const authHeader = req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
      }
    }

    if (!token) {
      try {
        const cookieStore = await cookies();
        token = cookieStore.get(COOKIE_NAME)?.value;
      } catch {}
    }

    if (!token) {
      try {
        const headerStore = await headers();
        const authHeader = headerStore.get('authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
          token = authHeader.substring(7).trim();
        }
      } catch {}
    }

    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecretKey());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Clear session cookie (logout)
 */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}
