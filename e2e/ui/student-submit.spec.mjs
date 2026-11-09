import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BASE_URL, fixtures } from '../helpers/env.mjs';
import { createClient } from '../helpers/api-client.mjs';
import { setupWorld, SOLUTION_PY } from '../helpers/fixtures.mjs';
import { uiLogin, gotoLocalized } from '../helpers/ui.mjs';

// UI: student task-solving view → submit solution → results view
// (thesis screens: student_task_view.png, submission_details.png)

const teacher = fixtures.teacher();
const student = fixtures.student();
const client = createClient(BASE_URL);
let world = {};

test.beforeAll(async () => {
  world = await setupWorld(client, teacher, student);
});

test('student logs in, opens the task, submits a solution and sees results', async ({ page }) => {
  await uiLogin(page, student.email, student.password);

  // Task-solving view (split pane: statement + submission controls)
  await gotoLocalized(page, `/dashboard/tasks/${world.taskId}`);
  await expect(page.getByText(/submit your solution/i)).toBeVisible({ timeout: 20_000 });

  // Upload solution + pick language (custom shadcn Select: trigger + option)
  const solutionPath = join(tmpdir(), `ui-solution-${Date.now()}.py`);
  writeFileSync(solutionPath, SOLUTION_PY);
  await page.locator('input[type="file"]').first().setInputFiles(solutionPath);
  await page.getByRole('button', { name: /select a language/i }).click();
  await page.getByRole('option', { name: /python/i }).first().click();

  await page.getByRole('button', { name: /submit solution/i }).click();

  // Redirects to the submission details view
  await page.waitForURL(/submissions\/\d+/, { timeout: 30_000 });

  // Worker verdict + per-test status appear on the results view
  await expect(page.getByText(/passed|accepted|evaluated|failed/i).first()).toBeVisible({
    timeout: 90_000,
  });
});
