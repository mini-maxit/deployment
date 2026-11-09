import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BASE_URL } from './env.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORLD_FILE = join(HERE, '..', 'world.json');

// ---- test-env SQL bootstrap (no admin exists yet; no language seed in migrations) ----
// Reported as a deployment finding: production needs an admin + language rows
// migrated from the legacy database.

function dbContainer() {
  const id = execFileSync('docker', ['ps', '-qf', 'name=maxit_db'], { encoding: 'utf8' }).trim();
  if (!id) throw new Error('maxit_db container not found');
  return id;
}

export function sql(query) {
  return execFileSync(
    'docker',
    ['exec', dbContainer(), 'psql', '-U', 'postgres', '-d', 'maxit', '-t', '-A', '-c', query],
    { encoding: 'utf8' },
  ).trim();
}

export function seedLanguages() {
  // Worker supports CPP 11/14/17/20 and PYTHON 3.10/3.11/3.12 (worker/pkg/languages).
  const rows = [
    ['CPP', '11', 'cpp'], ['CPP', '14', 'cpp'], ['CPP', '17', 'cpp'], ['CPP', '20', 'cpp'],
    ['PYTHON', '3.10', 'py'], ['PYTHON', '3.11', 'py'], ['PYTHON', '3.12', 'py'],
  ];
  for (const [type, version, ext] of rows) {
    sql(
      `INSERT INTO maxit.language_configs (type, version, file_extension, is_disabled)
       SELECT '${type}', '${version}', '${ext}', false
       WHERE NOT EXISTS (
         SELECT 1 FROM maxit.language_configs WHERE type = '${type}' AND version = '${version}'
       )`,
    );
    // Repair: rows have been observed with is_disabled flipped on.
    sql(`UPDATE maxit.language_configs SET is_disabled = false WHERE type = '${type}' AND version = '${version}'`);
  }
}

export function promoteUser(userId, role) {
  sql(`UPDATE maxit.users SET role = '${role}' WHERE id = ${userId}`);
}

export async function registerAndPromote(client, user, role) {
  const reg = await client.register(user);
  if (reg.status !== 201) throw new Error(`register failed: ${reg.status}`);
  const me = await (await client.me((await reg.json()).data.accessToken)).json();
  promoteUser(me.data.id, role);
  // JWT carries the role claim — re-login so the token reflects the promotion.
  const login = await client.login(user.email, user.password);
  if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
  const token = (await login.json()).data.accessToken;
  return { id: me.data.id, token, user };
}

// ---- task archive (zip) matching backend expectations ----
// description + input/N.in + output/N.out, uploaded as multipart "archive".

export function makeTaskArchive() {
  // Task: sum of two integers. Solution contract: print(input_a + input_b).
  const dir = mkdtempSync(join(tmpdir(), 'maxit-task-'));
  mkdirSync(join(dir, 'task', 'input'), { recursive: true });
  mkdirSync(join(dir, 'task', 'output'), { recursive: true });
  writeFileSync(join(dir, 'task', 'description.pdf'), '%PDF-1.4 fake description');
  writeFileSync(join(dir, 'task', 'input', '1.in'), '2 3\n');
  writeFileSync(join(dir, 'task', 'output', '1.out'), '5\n');
  const zipPath = join(dir, 'task.zip');
  execFileSync('zip', ['-q', '-r', zipPath, 'task'], { cwd: dir });
  return { zipPath, dir };
}

export const SOLUTION_PY = 'print(sum(map(int, input().split())))\n';

// ---- full teacher-side world used by J2/J3 ----
// Registers teacher + student, promotes teacher, creates task with tests,
// group with student, active contest with the task assigned, then has the
// student register and the teacher approve (U8 approval path).

export async function setupWorld(client, teacher, student) {
  seedLanguages();
  const t = await registerAndPromote(client, teacher, 'teacher');
  const s = await registerAndPromote(client, student, 'student');

  // T1: create task with test cases
  const { zipPath } = makeTaskArchive();
  const form = new FormData();
  form.set('title', `Sum Task ${Date.now().toString(36)}`);
  form.set('isVisible', 'true');
  form.set('archive', new Blob([readFileSync(zipPath)]), 'task.zip');
  const taskRes = await client.postForm('/api/v1/tasks-management/tasks', t.token, form);
  const taskBody = await taskRes.json();
  if (taskRes.status !== 200 || !taskBody.ok) {
    throw new Error(`task create failed: ${taskRes.status} ${JSON.stringify(taskBody)}`);
  }
  const taskId = taskBody.data.id;

  // T2: group with student
  const groupRes = await client.post('/api/v1/groups-management/groups', t.token, {
    name: `grp ${Date.now().toString(36)}`,
  });
  const groupId = (await groupRes.json()).data.id;
  await client.post(`/api/v1/groups-management/groups/${groupId}/users`, t.token, {
    userIDs: [s.id],
  });

  // T3: contest active now
  const startAt = new Date(Date.now() - 5 * 60_000).toISOString();
  const endAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const contestRes = await client.post('/api/v1/contests-management/contests', t.token, {
    name: `contest ${Date.now().toString(36)}`,
    description: 'e2e contest',
    startAt,
    endAt,
    isRegistrationOpen: true,
    isSubmissionOpen: true,
    isVisible: true,
  });
  const contestBody = await contestRes.json();
  if (contestRes.status !== 200 || !contestBody.ok) {
    throw new Error(`contest create failed: ${contestRes.status} ${JSON.stringify(contestBody)}`);
  }
  const contestId = contestBody.data.id;

  // T4: assign task to contest
  await client.post(`/api/v1/contests-management/contests/${contestId}/tasks`, t.token, {
    taskId,
    startAt,
    endAt,
  });

  // U8: student registers, teacher approves
  await client.post(`/api/v1/contests/${contestId}/register`, s.token);
  await client.post(
    `/api/v1/contests-management/contests/${contestId}/registration-requests/${s.id}/approve`,
    t.token,
  );

  return { teacher: t, student: s, taskId, groupId, contestId, languageTag: 'PYTHON/3.12' };
}

export function saveWorld(world) {
  writeFileSync(WORLD_FILE, JSON.stringify(world, null, 2));
}

export function loadWorld() {
  if (!existsSync(WORLD_FILE)) throw new Error('world.json missing — run the student journey first');
  return JSON.parse(readFileSync(WORLD_FILE, 'utf8'));
}

export async function languageId(client, token, type, version) {
  const res = await client.get('/api/v1/submissions/languages', token);
  const body = await res.json();
  const lang = body.data.find((l) => l.language === type && l.version === version && !l.isDisabled);
  if (!lang) throw new Error(`language ${type}/${version} not found in ${JSON.stringify(body.data)}`);
  return lang.id;
}

export { BASE_URL, rmSync };
