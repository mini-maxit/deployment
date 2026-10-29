import { test, expect } from '@playwright/test';
import { BASE_URL, fixtures } from '../helpers/env.mjs';
import { createClient } from '../helpers/api-client.mjs';
import { registerAndPromote, seedLanguages } from '../helpers/fixtures.mjs';
import { uiLogin } from '../helpers/ui.mjs';

// UI: login + logout (thesis auth flow)

const student = fixtures.student();
const client = createClient(BASE_URL);

test.beforeAll(async () => {
  seedLanguages();
  await registerAndPromote(client, student, 'student');
});

test('student can log in through the UI and reach the dashboard', async ({ page }) => {
  await uiLogin(page, student.email, student.password);
  await expect(page).toHaveURL(/dashboard/);
});

test('student can log out through the UI', async ({ page }) => {
  await uiLogin(page, student.email, student.password);
  await page.getByRole('button', { name: /logout|log out|sign out/i }).first().click();
  await page.waitForURL(/login|\//, { timeout: 20_000 });
});
