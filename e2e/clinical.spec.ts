import { test, expect } from '@playwright/test';
import { USERS, login, SYNTHETIC_PATIENT_NAME } from './helpers';

test.describe('Patient workflows', () => {
  test('6. global patient search returns the synthetic patient', async ({ page }) => {
    await login(page, USERS.doctor.email, USERS.doctor.password);

    await page.getByText('Search patients...').click();

    const searchInput = page.locator(
      'input[placeholder="Fast Patient Search (by ID, Name, Phone, or Diagnosis)..."]'
    );
    await expect(searchInput).toBeVisible({ timeout: 20_000 });

    const searchResponse = page.waitForResponse(
      (r) => r.url().includes('/api/patients?q=') && r.status() === 200
    );
    await searchInput.fill('E2E SYNTHETIC');
    const res = await searchResponse;
    expect(res.status(), 'search hit the Express backend').toBe(200);

    await expect(page.getByText(SYNTHETIC_PATIENT_NAME, { exact: false }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('7. creating a patient registers it and rejects a duplicate phone', async ({ page }) => {
    await login(page, USERS.doctor.email, USERS.doctor.password);
    await page.getByRole('button', { name: /Add Patient/i }).first().click();

    await expect(page.getByText('New Patient Intake & Registration')).toBeVisible({ timeout: 30_000 });

    const uniquePhone = `0399${Date.now().toString().slice(-7)}`;
    const name = `E2E SYNTHETIC CREATED ${Date.now()}`;

    await page.locator('input[placeholder="e.g. Dr. Catherine Vance-Lowe"]').fill(name);
    await page.locator('input[placeholder="+1 (555) 000-0000"]').fill(uniquePhone);

    const createResponse = page.waitForResponse(
      (r) => r.url().includes('/api/patients') && r.request().method() === 'POST'
    );
    await page.locator('form button[type="submit"]').first().click();
    const created = await createResponse;
    expect([200, 201]).toContain(created.status());

    await expect(page.getByText(/Patient Registered|registered successfully/i).first()).toBeVisible({ timeout: 20_000 });

    // Duplicate guard: same phone number must be refused.
    await page.getByRole('button', { name: /Add Patient/i }).first().click();
    await expect(page.getByText('New Patient Intake & Registration')).toBeVisible({ timeout: 30_000 });
    await page.locator('input[placeholder="e.g. Dr. Catherine Vance-Lowe"]').fill(`${name} DUP`);
    await page.locator('input[placeholder="+1 (555) 000-0000"]').fill(uniquePhone);

    const dupResponse = page.waitForResponse(
      (r) => r.url().includes('/api/patients') && r.request().method() === 'POST'
    );
    await page.locator('form button[type="submit"]').first().click();
    const dup = await dupResponse;
    expect(dup.status(), 'duplicate phone refused with 400').toBe(400);
  });

  test('8. reports screen loads live aggregates from Express', async ({ page }) => {
    await login(page, USERS.admin.email, USERS.admin.password);

    const reportsResponse = page.waitForResponse(
      (r) => r.url().includes('/api/reports') && r.status() === 200
    );
    await page.getByRole('button', { name: 'Reports', exact: true }).click();
    const res = await reportsResponse;
    expect(res.status(), 'GET /api/reports served by Express').toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.summary, 'live summary present (not placeholder data)').toBeTruthy();
    expect(typeof body.data.summary.totalPatients).toBe('number');

    await expect(page.getByText(/Reports|Analytics/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
