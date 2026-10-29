import { defineConfig } from '@playwright/test';
import { BASE_URL } from './helpers/env.mjs';

export default defineConfig({
  testDir: './ui',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: BASE_URL,
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    // Bypass ngrok's free-tier browser interstitial (shown to every fresh browser context).
    extraHTTPHeaders: { 'ngrok-skip-browser-warning': '1' },
  },
});
