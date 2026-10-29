import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, fixtures } from '../helpers/env.mjs';
import { createClient } from '../helpers/api-client.mjs';
import { setupWorld, languageId, SOLUTION_PY, saveWorld } from '../helpers/fixtures.mjs';

// J3 — student journeys (U1–U12 core loop), full worker evaluation chain.
// Self-contained: builds its own teacher/student world (parallelism-safe).

const teacher = fixtures.teacher();
const student = fixtures.student();
const client = createClient(BASE_URL);
let world = {};
let sToken = '';
let submissionId = 0;

before(async () => {
  world = await setupWorld(client, teacher, student);
  sToken = world.student.token;
});

test('U1/U6: student sees assigned/available tasks', async () => {
  const my = await (await client.get('/api/v1/tasks/my', sToken)).json();
  const all = await (await client.get('/api/v1/tasks', sToken)).json();
  const visible = JSON.stringify(my.data) + JSON.stringify(all.data);
  assert.ok(visible.includes(`"id":${world.taskId}`) || visible.includes(`"id": ${world.taskId}`),
    `task ${world.taskId} visible to student`);
});

test('U7/U9/U10: contest listed, student registered, contest active', async () => {
  const contests = await (await client.get('/api/v1/contests', sToken)).json();
  const my = await (await client.get('/api/v1/contests/my', sToken)).json();
  const active = await (await client.get('/api/v1/contests/my/active', sToken)).json();
  const joined = JSON.stringify(my.data) + JSON.stringify(active.data);
  assert.ok(joined.includes(`"id":${world.contestId}`) || joined.includes(`"id": ${world.contestId}`),
    'student contest appears in my/active lists');
  assert.ok(JSON.stringify(contests.data).length >= 2, 'contest list non-empty');
});

test('U2: student submits solution; worker evaluates it (full Docker chain)', async () => {
  const langId = await languageId(client, sToken, 'PYTHON', '3.12');
  const form = new FormData();
  form.set('taskID', String(world.taskId));
  form.set('languageID', String(langId));
  form.set('contestID', String(world.contestId));
  form.set('solution', new Blob([SOLUTION_PY]), 'solution.py');

  const res = await client.postForm('/api/v1/submissions/submit', sToken, form);
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  submissionId = body.data.id ?? body.data.submissionId;
  assert.ok(submissionId, 'submission id returned');

  // Poll until evaluated (worker consumes queue, runs Docker, uploads results)
  let submission = null;
  for (let i = 0; i < 60; i++) {
    const poll = await (await client.get(`/api/v1/submissions/${submissionId}`, sToken)).json();
    submission = poll.data;
    if (submission.status === 'evaluated' || submission.status === 'lost') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  assert.ok(submission, 'submission fetched');
  assert.equal(submission.status, 'evaluated', `worker verdict, got status=${submission.status}`);

  // U3: verdict + per-test results
  assert.ok(submission.result, 'result present');
  assert.ok(Array.isArray(submission.result.testResults) && submission.result.testResults.length >= 1,
    'per-test results present');
  const passed = submission.result.testResults.filter((t) => t.passed === true).length;
  assert.equal(passed, 1, `test case passed (results: ${JSON.stringify(submission.result.testResults)})`);
});

test('signed file URLs point at the public domain and are downloadable', async () => {
  const poll = await (await client.get(`/api/v1/submissions/${submissionId}`, sToken)).json();
  const urls = [poll.data.fileUrl, ...(poll.data.result?.testResults ?? []).flatMap(
    (t) => [t.stdoutUrl, t.stderrUrl, t.diffUrl],
  )].filter(Boolean);

  assert.ok(urls.length >= 1, 'at least the submission file URL is present');
  for (const u of urls) {
    assert.ok(u.startsWith(`${BASE_URL}/files/`), `URL is public-domain signed path: ${u}`);
  }

  // Review Focus #5: fetch one signed URL through the domain (nginx rewrite vs signature)
  const res = await fetch(urls[0], { redirect: 'manual' });
  assert.equal(res.status, 200, `signed download works through domain: ${urls[0]}`);
});

test('U4/U5: submission history (global and per task)', async () => {
  const mine = await (await client.get('/api/v1/submissions/my', sToken)).json();
  assert.equal(mine.ok, true);
  assert.ok(JSON.stringify(mine.data).includes(`"id":${submissionId}`) || JSON.stringify(mine.data).includes(`"id": ${submissionId}`),
    'submission in history');

  const perTask = await (await client.get(`/api/v1/submissions/tasks/${world.taskId}`, sToken)).json();
  assert.equal(perTask.ok, true);
  assert.ok(JSON.stringify(perTask.data).includes(String(submissionId)), 'submission listed per task');
});

test('U11: student sees own contest results', async () => {
  const res = await client.get(`/api/v1/contests/${world.contestId}/results/my`, sToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
});

test('persist world for leak audit', async () => {
  const poll = await (await client.get(`/api/v1/submissions/${submissionId}`, sToken)).json();
  saveWorld({
    ...world,
    submissionId,
    fileUrl: poll.data.fileUrl,
    baseUrl: BASE_URL,
  });
  assert.ok(true);
});
