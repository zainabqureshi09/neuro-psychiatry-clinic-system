import { test, expect } from '@playwright/test';
import { USERS, login, expectLoggedOut } from './helpers';

test.describe('Authentication & session', () => {
  test('1. login with valid synthetic credentials', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 60_000 });

    await page.locator('input[type="email"]').fill(USERS.doctor.email);
    await page.locator('input[type="password"]').fill(USERS.doctor.password);

    const loginResponse = page.waitForResponse(
      (r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'
    );
    await page.locator('button[type="submit"]').click();

    const res = await loginResponse;
    expect(res.status(), 'login endpoint returned 200').toBe(200);

    await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 45_000 });

    const token = await page.evaluate(() => localStorage.getItem('psychiatrist_token'));
    expect(token, 'session token stored in localStorage').toBeTruthy();
    expect(token!.split('.').length, 'token looks like a JWT').toBe(3);
  });

  test('2. login with an invalid password is refused', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 60_000 });

    await page.locator('input[type="email"]').fill(USERS.doctor.email);
    await page.locator('input[type="password"]').fill('DefinitelyWrong!123');

    const loginResponse = page.waitForResponse(
      (r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST'
    );
    await page.locator('button[type="submit"]').click();

    const res = await loginResponse;
    expect(res.status(), 'invalid credentials must be rejected').toBe(401);

    // Still on the login form, and no session token was issued.
    await expect(page.locator('input[type="password"]')).toBeVisible();
    const token = await page.evaluate(() => localStorage.getItem('psychiatrist_token'));
    expect(token, 'no token after a failed login').toBeFalsy();
  });

  test('3. session persists across a page reload', async ({ page }) => {
    await login(page, USERS.admin.email, USERS.admin.password);

    const tokenBefore = await page.evaluate(() => localStorage.getItem('psychiatrist_token'));
    expect(tokenBefore).toBeTruthy();

    const meResponse = page.waitForResponse((r) => r.url().includes('/api/auth/me'));
    await page.reload();
    const me = await meResponse;
    expect(me.status(), '/api/auth/me accepts the restored session').toBe(200);

    // Login form must not reappear.
    await expect(page.locator('input[type="password"]')).toHaveCount(0, { timeout: 45_000 });
    const tokenAfter = await page.evaluate(() => localStorage.getItem('psychiatrist_token'));
    expect(tokenAfter).toBe(tokenBefore);
  });

  test('4. logout clears the session', async ({ page }) => {
    await login(page, USERS.admin.email, USERS.admin.password);

    const logoutResponse = page.waitForResponse((r) => r.url().includes('/api/auth/logout'));
    await page.locator('[title="Sign Out"]').click();
    const res = await logoutResponse;
    expect(res.status(), 'logout endpoint returned 200').toBe(200);

    await expectLoggedOut(page);
  });
});

test.describe('Role-based access control (UI gating)', () => {
  test('5a. ADMIN sees the admin-only navigation', async ({ page }) => {
    await login(page, USERS.admin.email, USERS.admin.password);
    await expect(page.getByText('Users & Roles', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Audit Log', { exact: true })).toBeVisible();
  });

  test('5b. THERAPIST does not see admin-only navigation', async ({ page }) => {
    await login(page, USERS.therapist.email, USERS.therapist.password);
    // Sidebar is filtered by the authenticated role (Sidebar.tsx rolesAllowed).
    await expect(page.getByText('Users & Roles', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Audit Log', { exact: true })).toHaveCount(0);
    // ...but a permitted item is present, proving the sidebar rendered at all.
    await expect(page.getByText('Patients', { exact: true }).first()).toBeVisible();
  });

  test('5c. RECEPTIONIST does not see admin-only navigation', async ({ page }) => {
    await login(page, USERS.reception.email, USERS.reception.password);
    await expect(page.getByText('Users & Roles', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Backup & Export', { exact: true })).toHaveCount(0);
  });
});
