import { BASE_URL } from './env.mjs';

// Paraglide negotiates locale via the PARAGLIDE_LOCALE cookie; pin English so
// specs can use exact en.json labels regardless of browser defaults.
export async function gotoLocalized(page, path) {
  await page.context().addCookies([
    { name: 'PARAGLIDE_LOCALE', value: 'en', url: BASE_URL },
  ]);
  await page.goto(path);
}

export async function uiLogin(page, email, password) {
  await gotoLocalized(page, '/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL(/dashboard/, { timeout: 20_000 });
}
