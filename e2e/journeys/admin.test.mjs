import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, fixtures } from '../helpers/env.mjs';
import { createClient } from '../helpers/api-client.mjs';
import { registerAndPromote, seedLanguages } from '../helpers/fixtures.mjs';

// J4 — admin journeys (A1–A2) + access-control negatives

const admin = fixtures.admin();
const student = fixtures.student();
const client = createClient(BASE_URL);
let A = {};
let S = {};

before(async () => {
  seedLanguages();
  A = await registerAndPromote(client, admin, 'admin');
  S = await registerAndPromote(client, student, 'student');
});

test('A1: admin monitors worker status', async () => {
  const res = await client.get('/api/v1/workers/status', A.token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('A1: admin sees queue status', async () => {
  const res = await client.get('/api/v1/workers/queue/status', A.token);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('A2: admin promotes user to teacher and demotes back', async () => {
  const up = await client.patch(`/api/v1/users/${S.id}`, A.token, { role: 'teacher' });
  assert.ok(up.status < 300, `promote: ${up.status}`);

  const seen = await (await client.get(`/api/v1/users/${S.id}`, A.token)).json();
  assert.equal(seen.data.role, 'teacher');

  const down = await client.patch(`/api/v1/users/${S.id}`, A.token, { role: 'student' });
  assert.ok(down.status < 300, `demote: ${down.status}`);
  const seen2 = await (await client.get(`/api/v1/users/${S.id}`, A.token)).json();
  assert.equal(seen2.data.role, 'student');
});

test('access control: student cannot use teacher management API', async () => {
  const res = await client.get('/api/v1/tasks-management/tasks/created', S.token);
  assert.ok(res.status === 403 || res.status === 401, `expected denial, got ${res.status}`);
});

test('access control: unauthenticated request is rejected', async () => {
  const res = await client.get('/api/v1/users/me');
  assert.ok(res.status === 401 || res.status === 403, `expected denial, got ${res.status}`);
});
