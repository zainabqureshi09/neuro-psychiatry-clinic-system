import { Page, expect } from '@playwright/test';

/** Synthetic accounts created by scripts/e2eFixtures.ts (RFC 2606 `.test` TLD). */
export const USERS = {
  admin: { email: 'e2e.admin@npcs.test', password: 'E2eAdmin!2026', role: 'ADMIN' },
  doctor: { email: 'e2e.doctor@npcs.test', password: 'E2eDoctor!2026', role: 'DOCTOR' },
  therapist: { email: 'e2e.therapist@npcs.test', password: 'E2eTherapist!2026', role: 'THERAPIST' },
  reception: { email: 'e2e.reception@npcs.test', password: 'E2eReception!2026', role: 'RECEPTION' },
};

export const SYNTHETIC_PATIENT_NAME = 'E2E SYNTHETIC PATIENT';

/**
 * The app boots with isAuthenticated=true and then calls GET /api/auth/me.
 * Without a session that call fails and the login screen appears, so we always
 * wait for the login form before interacting with it.
 */
export async function gotoLogin(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 60_000 });
}

export async function login(page: Page, email: string, password: string): Promise<void> {
  await gotoLogin(page);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();

  // A successful login unmounts the login form entirely.
  await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 45_000 });
}

export async function expectLoggedOut(page: Page): Promise<void> {
  await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 45_000 });
  const token = await page.evaluate(() => localStorage.getItem('psychiatrist_token'));
  expect(token === null || token === '').toBeTruthy();
}
