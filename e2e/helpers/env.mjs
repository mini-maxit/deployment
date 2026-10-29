import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const out = {};
  try {
    const raw = readFileSync(join(HERE, '..', '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {
    // .env is written by scripts/start-ngrok.sh
  }
  return out;
}

const env = loadEnv();

export const BASE_URL = (process.env.BASE_URL || env.BASE_URL || '').replace(/\/+$/, '');
if (!BASE_URL) {
  throw new Error('BASE_URL missing: run deployment/scripts/start-ngrok.sh or export BASE_URL');
}

// Unique per run so re-runs and parallel spec modules never collide
// (Playwright loads all spec files in one worker process).
// Keep compact: username max 30 chars (backend MAX_LENGTH_30).
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

// Password policy (backend/package/utils.PasswordValidator):
// >=8 chars, upper, lower, digit, special from [#!?@$%^&*-]
const PASSWORD = 'E2ePass!1x';
// Username policy (UsernameValidator): ^[a-zA-Z][a-zA-Z0-9_]*$, max 30 chars.

function user(role, tag) {
  // Unique per CALL: Playwright loads every spec file in one worker process,
  // so per-module RUN alone collides across specs sharing a persona.
  const nonce = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return {
    name: 'E2e',
    surname: `Test${tag}`,
    email: `e2e-${tag}-${nonce}@example.com`,
    username: `e2e_${tag}_${nonce}`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
  };
}

export const fixtures = {
  student: () => user('student', 'stu'),
  teacher: () => user('teacher', 'tea'),
  admin: () => user('admin', 'adm'),
};
