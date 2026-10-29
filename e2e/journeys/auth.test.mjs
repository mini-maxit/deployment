import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_URL, fixtures } from '../helpers/env.mjs';
import { createClient } from '../helpers/api-client.mjs';

// J1 — auth lifecycle (U13 + register/login verification)
// Sequential on purpose: password change and logout mutate shared state.

const student = fixtures.student();
const client = createClient(BASE_URL);
let accessToken = '';
let userId = 0;
const newPassword = 'Rotated1!Pass';

test('register returns 201 with access token and secure HttpOnly refresh cookie', async () => {
  const res = await client.register(student);
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.data.accessToken, 'string');
  assert.ok(body.data.accessToken.length > 0);
  const cookies = res.headers.getSetCookie();
  const refresh = cookies.find((c) => c.startsWith('refresh_token='));
  assert.ok(refresh, 'refresh_token cookie is set');
  assert.match(refresh, /HttpOnly/i);
  assert.match(refresh, /Secure/i);
  accessToken = body.data.accessToken;
});

test('login with email and password returns fresh access token', async () => {
  const res = await client.login(student.email, student.password);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.data.accessToken, 'string');
  accessToken = body.data.accessToken;
});

test('GET /users/me returns the authenticated user', async () => {
  const res = await client.me(accessToken);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.data.username, student.username);
  assert.equal(body.data.email, student.email);
  userId = body.data.id;
});

test('refresh mints a new access token from the cookie alone', async () => {
  const res = await client.refresh();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.data.accessToken, 'string');
  assert.notEqual(body.data.accessToken, accessToken);
  accessToken = body.data.accessToken;
});

test('password change (U13) then login with the new password succeeds', async () => {
  const res = await client.changePassword(userId, accessToken, student.password, newPassword, newPassword);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);

  const loginRes = await client.login(student.email, newPassword);
  assert.equal(loginRes.status, 200);
});

test('login with the old password is rejected', async () => {
  const res = await client.login(student.email, student.password);
  assert.equal(res.status, 401);
});

test('U13: profile edit (name/surname) is applied', async () => {
  const res = await client.patch(`/api/v1/users/${userId}`, accessToken, {
    name: 'E2eRenamed',
    surname: 'Testperson',
  });
  assert.ok(res.status < 300, `edit profile: ${res.status}`);
  const me = await (await client.me(accessToken)).json();
  assert.equal(me.data.name, 'E2eRenamed');
  assert.equal(me.data.surname, 'Testperson');
});

test('logout clears the session and a stale refresh cookie is rejected', async () => {
  const staleCookie = client.getRefreshCookie();
  assert.ok(staleCookie, 'refresh cookie present before logout');

  const res = await client.logout(accessToken);
  assert.equal(res.status, 200);

  // Browser-equivalent behaviour: cookie jar is empty after logout.
  const noCookieRes = await client.refresh();
  assert.ok(noCookieRes.status >= 400, `refresh without cookie must fail, got ${noCookieRes.status}`);

  // Stronger: a captured pre-logout cookie must not mint tokens either.
  const staleRes = await client.refreshWithCookie(staleCookie);
  assert.ok(staleRes.status >= 400, `stale refresh cookie must be rejected, got ${staleRes.status}`);
});

test('duplicate registration is rejected with 4xx', async () => {
  const res = await client.register(student);
  assert.ok(res.status >= 400 && res.status < 500, `expected 4xx, got ${res.status}`);
  const body = await res.json();
  assert.equal(body.ok, false);
});
