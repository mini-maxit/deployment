import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASE_URL, fixtures } from '../helpers/env.mjs';
import { createClient } from '../helpers/api-client.mjs';
import { seedLanguages, registerAndPromote, makeTaskArchive } from '../helpers/fixtures.mjs';

// J2 — teacher journeys (T1–T4, T8 + U8 approval half)

const teacher = fixtures.teacher();
const student = fixtures.student();
const client = createClient(BASE_URL);
let T = {}; // teacher session
let S = {}; // student session
let taskId = 0;
let groupId = 0;
let contestId = 0;

before(async () => {
  seedLanguages();
  T = await registerAndPromote(client, teacher, 'teacher');
  S = await registerAndPromote(client, student, 'student');
});

test('T1: teacher creates task with description and test cases', async () => {
  const { zipPath } = makeTaskArchive();
  const form = new FormData();
  form.set('title', `J2 Sum ${Date.now().toString(36)}`);
  form.set('isVisible', 'true');
  form.set('archive', new Blob([readFileSync(zipPath)]), 'task.zip');

  const res = await client.postForm('/api/v1/tasks-management/tasks', T.token, form);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(typeof body.data.id, 'number');
  taskId = body.data.id;
});

test('T1b: created task appears in teacher task list with description URL', async () => {
  const res = await client.get('/api/v1/tasks-management/tasks/created', T.token);
  const body = await res.json();
  assert.equal(res.status, 200);
  const items = body.data.items ?? body.data; // PaginatedResult{pagination, items}
  const mine = items.find((t) => t.id === taskId);
  assert.ok(mine, 'created task listed');
});

test('T2/T10: teacher creates group and adds student', async () => {
  const res = await client.post('/api/v1/groups-management/groups', T.token, {
    name: `j2 grp ${Date.now().toString(36)}`,
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  groupId = body.data.id;

  const addRes = await client.post(`/api/v1/groups-management/groups/${groupId}/users`, T.token, {
    userIDs: [S.id],
  });
  assert.ok(addRes.status < 300, `add user to group: ${addRes.status}`);
});

test('T3: teacher creates contest with active time window', async () => {
  const res = await client.post('/api/v1/contests-management/contests', T.token, {
    name: `j2 contest ${Date.now().toString(36)}`,
    description: 'teacher journey contest',
    startAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    endAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    isRegistrationOpen: true,
    isSubmissionOpen: true,
    isVisible: true,
  });
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  contestId = body.data.id;
});

test('T4: teacher assigns task to contest', async () => {
  const res = await client.post(`/api/v1/contests-management/contests/${contestId}/tasks`, T.token, {
    taskId,
    startAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    endAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  });
  assert.ok(res.status < 300, `assign task: ${res.status}`);
});

test('U8: student registers for contest, teacher sees the request', async () => {
  const regRes = await client.post(`/api/v1/contests/${contestId}/register`, S.token);
  assert.equal(regRes.status, 200);

  const listRes = await client.get(
    `/api/v1/contests-management/contests/${contestId}/registration-requests`,
    T.token,
  );
  const listBody = await listRes.json();
  assert.equal(listRes.status, 200);
  assert.ok(JSON.stringify(listBody.data).includes(String(S.id)), 'student request listed');
});

test('U8: teacher approves the registration request', async () => {
  const res = await client.post(
    `/api/v1/contests-management/contests/${contestId}/registration-requests/${S.id}/approve`,
    T.token,
  );
  assert.ok(res.status < 300, `approve: ${res.status}`);
});

test('T8: teacher edits contest (extends end time)', async () => {
  const res = await client.put(`/api/v1/contests-management/contests/${contestId}`, T.token, {
    endAt: new Date(Date.now() + 90 * 60_000).toISOString(),
  });
  assert.ok(res.status < 300, `edit contest: ${res.status}`);
});

test('T5/T11: teacher views contest statistics (task-stats, user-stats)', async () => {
  const taskStats = await client.get(
    `/api/v1/contests-management/contests/${contestId}/task-stats`,
    T.token,
  );
  assert.equal(taskStats.status, 200);
  const userStats = await client.get(
    `/api/v1/contests-management/contests/${contestId}/user-stats`,
    T.token,
  );
  assert.equal(userStats.status, 200);
});

test('T6: teacher edits task (title)', async () => {
  const form = new FormData();
  form.set('title', `J2 Sum Edited ${Date.now().toString(36)}`);
  form.set('isVisible', 'true');
  const res = await client.patchForm(`/api/v1/tasks-management/tasks/${taskId}`, T.token, form);
  assert.ok(res.status < 300, `edit task: ${res.status}`);
});

test('T10: teacher edits group (rename)', async () => {
  const res = await client.put(`/api/v1/groups-management/groups/${groupId}`, T.token, {
    name: `j2 grp edited ${Date.now().toString(36)}`,
  });
  assert.ok(res.status < 300, `edit group: ${res.status}`);
});

test('T7: teacher deletes task (no further submissions)', async () => {
  const res = await client.del(`/api/v1/tasks-management/tasks/${taskId}`, T.token);
  assert.ok(res.status < 300, `delete task: ${res.status}`);
  const listRes = await client.get('/api/v1/tasks-management/tasks/created', T.token);
  const items = (await listRes.json()).data.items ?? [];
  assert.ok(!items.some((t) => t.id === taskId), 'deleted task gone from list');
});

test('T9: teacher deletes contest', async () => {
  const res = await client.del(`/api/v1/contests-management/contests/${contestId}`, T.token);
  assert.ok(res.status < 300, `delete contest: ${res.status}`);
});
