import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BASE_URL } from './helpers/env.mjs';
import { loadWorld } from './helpers/fixtures.mjs';

// Localhost-leak audit (Task 8): served content must never reference loopback
// or internal hosts. Paraglide's runtime.js contains internal URL parsing
// defaults ('http://localhost') — those are dead strings in bundle code and
// are allowlisted below with justification.

const LEAK = /localhost|127\.0\.0\.1|0\.0\.0\.0/;
const ALLOWLIST = [
  // paraglide runtime URL-parsing fallbacks (never used as fetch targets):
  { file: /paraglide|_app\/immutable/, pattern: /localhost(?::\d+)?/ },
];

function assertNoLeak(label, text) {
  const hits = text.split('\n').filter((line) => LEAK.test(line));
  const real = hits.filter((line) => !ALLOWLIST.some((a) => a.file.test(label) && a.pattern.test(line)));
  assert.equal(
    real.length,
    0,
    `${label}: ${real.length} localhost references, e.g. ${real[0]?.slice(0, 200)}`,
  );
}

test('served HTML contains no loopback references', async () => {
  const res = await fetch(`${BASE_URL}/`, {
    headers: { 'ngrok-skip-browser-warning': '1', Cookie: 'PARAGLIDE_LOCALE=en' },
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assertNoLeak('index.html', html);

  // Assets referenced from markup and inline module imports (./_app/... paths).
  const assets = [...new Set([...html.matchAll(/(?:\.\/)?(_app\/immutable\/[^"'\s\\)]+)/g)].map((m) => m[1]))];
  assert.ok(assets.length > 0, 'page references app assets');
  for (const asset of assets) {
    const assetRes = await fetch(`${BASE_URL}/${asset}`, { headers: { 'ngrok-skip-browser-warning': '1' } });
    assert.equal(assetRes.status, 200, `asset ${asset} served`);
    assertNoLeak(asset, await assetRes.text());
  }
});

test('API responses reference only the public domain', async () => {
  const world = loadWorld();
  assert.ok(world.fileUrl, 'J3 produced a signed file URL');
  assert.ok(world.fileUrl.startsWith(`${BASE_URL}/files/`), `signed URL on public domain: ${world.fileUrl}`);

  const res = await fetch(world.fileUrl, {
    headers: { 'ngrok-skip-browser-warning': '1' },
    redirect: 'manual',
  });
  assert.equal(res.status, 200, 'signed download over the public domain');
  const body = await res.text();
  assertNoLeak('signed-file-body', body);
});

test('auth pages carry no loopback references', async () => {
  for (const path of ['/login', '/register']) {
    const res = await fetch(BASE_URL + path, {
      headers: { 'ngrok-skip-browser-warning': '1', Cookie: 'PARAGLIDE_LOCALE=en' },
    });
    assert.equal(res.status, 200, `${path} served`);
    assertNoLeak(path, await res.text());
  }
});
