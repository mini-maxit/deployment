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

// Unique per run so re-runs against the same database do not collide.
const RUN = Date.now().toString(36);

// Password policy (backend/package/utils.PasswordValidator):
// >=8 chars, upper, lower, digit, special from [#!?@$%^&*-]
const PASSWORD = 'E2ePass!1x';
// Username policy (UsernameValidator): ^[a-zA-Z][a-zA-Z0-9_]*$

function user(role, tag) {
  return {
    name: 'E2e',
    surname: `Test${tag}`,
    email: `e2e-${tag}-${RUN}@example.com`,
    username: `e2e_${tag}_${RUN}`,
    password: PASSWORD,
    confirmPassword: PASSWORD,
  };
}

export const fixtures = {
  student: () => user('student', 'student'),
  teacher: () => user('teacher', 'teacher'),
  admin: () => user('admin', 'admin'),
};
