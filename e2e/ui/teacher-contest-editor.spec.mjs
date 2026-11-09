import { test, expect } from '@playwright/test';
import { BASE_URL, fixtures } from '../helpers/env.mjs';
import { createClient } from '../helpers/api-client.mjs';
import { setupWorld } from '../helpers/fixtures.mjs';
import { uiLogin, gotoLocalized } from '../helpers/ui.mjs';

// UI: teacher contest editor (thesis screen teacher_contest_edit.png)

const teacher = fixtures.teacher();
const student = fixtures.student();
const client = createClient(BASE_URL);
let world = {};

test.beforeAll(async () => {
  world = await setupWorld(client, teacher, student);
});

test('teacher edits contest details through the contest editor dialog', async ({ page }) => {
  await uiLogin(page, teacher.email, teacher.password);

  await gotoLocalized(page, '/dashboard/teacher/contests');
  await expect(page.getByText(/edit contest/i).first()).toBeVisible({ timeout: 20_000 });

  // Open the editor for the world contest (first Edit Contest button on the page)
  await page.getByRole('button', { name: /edit contest/i }).first().click();

  // Dialog: update the name and save (time-limit + task-set controls exist)
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const nameField = dialog.getByLabel(/name/i).first();
  const newName = `Edited Contest ${Date.now().toString(36)}`;
  await nameField.fill(newName);
  await dialog.getByRole('button', { name: /save|update/i }).first().click();

  // Success feedback and change visible in the list
  await expect(page.getByText(/updated successfully/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(newName).first()).toBeVisible({ timeout: 20_000 });
});
