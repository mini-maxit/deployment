# Swarm E2E Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the maxit application works end-to-end when deployed as a Docker Swarm stack behind a single public domain (ngrok), covering student/teacher/admin user journeys, and report exactly how many endpoints must be exposed publicly.

**Architecture:** Build the 4 service images (backend, frontend, file-storage, worker), deploy them as a swarm stack (`docker stack deploy`, single-node swarm on Docker Desktop for macOS) behind nginx which is the only published service (80/443). An ngrok tunnel gives the stack a real public HTTPS domain; every URL the app is configured with (frontend API base, file-storage public URL, SvelteKit ORIGIN, CORS) points at that domain, so any `localhost` leakage breaks the tests. Journey tests hit the public domain only: Node built-in test runner for API journeys (full U/T/A matrix) and Playwright for browser UI journeys. Repo-native test suites run as additional verification.

**Tech Stack:** Docker Swarm mode, nginx:alpine, ngrok v3 (CLI 3.39), Node 22 (`node --test`, fetch), Playwright (chromium), Go 1.x test suites (backend, file-storage, worker), SvelteKit + adapter-node (runtime envs via `$env/dynamic/public`).

**Spec:** `docs/superpowers/specs/2026-10-29-swarm-e2e-verification-design.md` (this plan derives from the verified user journeys in `mini-maxit/Engineering-Thesis`: U1–U13 student, T1–T14 teacher, A1–A2 admin).

## Global Constraints

- **Single public domain.** The only host ports the stack publishes are 80 and 443 on nginx. No service (backend :8000, frontend :3000, file-storage :8888/:8080, rabbitmq :5672/:15672, postgres :5432) publishes a host port or is reachable except via the nginx domain.
- **No `localhost` / `127.0.0.1` / `0.0.0.0` in runtime configuration or served content.** All app-level URLs use `$BASE_URL` (the ngrok domain): `FILE_STORAGE_PUBLIC_URL=$BASE_URL/files`, `PUBLIC_BACKEND_API_URL=$BASE_URL/api/v1`, `ORIGIN=$BASE_URL`, `CORS_ALLOWED_ORIGINS=$BASE_URL`.
- **Test secrets are explicit literals** (`JWT_SECRET_KEY`, `SIGNING_SECRET`) — never empty, never real credentials. Compose currently ships `JWT_SECRET_KEY=` empty and backend config treats it as required.
- **file-storage internal server (:8080) is never host-published.** Only the public signed-URL server (:8888) is reachable, and only through nginx `/files/` (GET-only). Backend and worker talk to `file-storage:8080` on the overlay network.
- **Signed URLs must be public-domain URLs.** `FILE_STORAGE_PUBLIC_URL` falls back to an internal URL when unset (backend `internal/config/config.go:120`) — the fallback is a documented failure mode the tests must catch.
- **Stack name is `maxit`.** Worker env `JOBS_DATA_VOLUME` must equal the stack-prefixed volume name `maxit_jobs-data` (compose comment in `deployment/docker-compose/docker-compose.yaml` warns about the `maxit_` prefix).
- **Platform:** single-node swarm on Docker Desktop for macOS (Darwin). Worker mounts `/var/run/docker.sock`; on macOS the daemon socket for containers is the VM path — worker runs in-Linux VM so `/var/run/docker.sock` is correct inside the container.
- Tests target the public domain only (BASE_URL), never direct service ports.

## Review Focus

These are failure modes the spec/journeys imply but the happy-path tests may miss. Each is pinned to the task whose tests exercise it.

1. **RabbitMQ `guest` remote login** — RabbitMQ denies `guest` from non-loopback by default; backend/worker connect from other containers. If denied at runtime: set `RABBITMQ_DEFAULT_USER`/`RABBITMQ_DEFAULT_PASS` in the stack and matching envs (Task 2 deploy step catches it; Task 5 J1 fails fast otherwise).
2. **`JOBS_DATA_VOLUME` prefix mismatch** — swarm names volumes `<stack>_<volume>`; a mismatch makes worker job containers fail to mount `jobs-data` at execution time only (Task 5 J3 submission-eval step asserts job completion).
3. **Signed URL host leakage / fallback** — if `FILE_STORAGE_PUBLIC_URL` is unset or wrong, signed links point at `http://file-storage:8080`-style internals and browser download breaks while API tests may still pass (Task 5 J3 asserts the URL string contains the ngrok domain AND `GET` over the domain returns 200).
4. **Refresh-cookie flow over HTTPS** — `refresh_token` cookie is `HttpOnly; Secure; SameSite=Strict` with a scoped path (`backend/internal/api/http/routes/auth.go:29-43`); a Secure cookie dropped over plain HTTP or wrong path silently breaks session renewal (Task 5 J1 exercises refresh after access-token expiry path).
5. **Nginx `/files/` rewrite vs signature binding** — signature is computed over the path (`path:expires`); if nginx rewrite ever stops stripping exactly the `/files` prefix, every download 403s (Task 4 and Task 5 J3 both fetch a signed URL through the domain).

---

## File Structure

All new artifacts live in the `deployment` git repo (`mini-maxit/deployment`), which owns deployment definitions and scripts. Nothing in backend/frontend-2.0/file-storage/worker source is modified.

- `deployment/docker-swarm/maxit-stack.yaml` — swarm stack file (replaces `docker-compose/docker-compose.yaml` for swarm; volumes fixed, secrets set, only nginx published).
- `deployment/nginx/conf/nginx.swarm-e2e.conf` — HTTP-only nginx config for the ngrok test (no 80→443 redirect; ngrok terminates public TLS). Derived from `deployment/nginx/conf/nginx.local.conf` routing (`/api/`, `/files/`, `/`, `/health`).
- `deployment/scripts/deploy-stack.sh` — `docker stack deploy` + readiness wait loop (nginx `/health`, backend `/api/v1/status`, file-storage health through domain).
- `deployment/scripts/start-ngrok.sh` — starts `ngrok http` against local nginx, prints/export `BASE_URL`, waits for tunnel up.
- `deployment/scripts/teardown.sh` — `docker stack rm`, ngrok kill, optional volume purge.
- `deployment/e2e/package.json` — Node 22, `"type": "module"`, scripts: `test:api`, `test:ui`, `test:leak`. No runtime deps for API tests.
- `deployment/e2e/helpers/api-client.mjs` — fetch wrapper: `register()`, `login()` (bearer + refresh cookie jar), `submitSolution()` multipart, `pollSubmission()`.
- `deployment/e2e/helpers/env.mjs` — reads `BASE_URL`, test credentials, timeouts.
- `deployment/e2e/journeys/auth.test.mjs` — J1 (U13 + auth lifecycle).
- `deployment/e2e/journeys/teacher-setup.test.mjs` — J2 (T1–T4, T8, U8 approval).
- `deployment/e2e/journeys/student-run.test.mjs` — J3 (U1–U12 core loop incl. worker eval).
- `deployment/e2e/journeys/admin.test.mjs` — J4 (A1–A2).
- `deployment/e2e/ui/*.spec.mjs` — Playwright specs (login, student submit+results, teacher contest editor).
- `deployment/e2e/leak-audit.test.mjs` — localhost-leak crawler over the domain.
- `deployment/e2e/report.md` — final deliverable: endpoint count, journey matrix results, swarm findings.

Tests run from the host against `$BASE_URL`. Node's built-in `node --test` runner is used so API journeys need zero installed dependencies (Node ≥ 22 on host).

---

### Task 1: Build the four service images

**Files:**
- Create: `deployment/scripts/build-images.sh`
- Test: none (verification steps instead — this task produces images, their tests are runtime smoke in Task 4)

**Interfaces:**
- Consumes: `backend/Dockerfile`, `frontend-2.0/Dockerfile`, `file-storage/Dockerfile`, `worker/Dockerfile`
- Produces: local images tagged `maxit/backend:latest`, `maxit/frontend:latest`, `seber/maxit-file-storage:latest`, `seber/maxit-worker:latest` (names must match `deployment/docker-compose/docker-compose.yaml` image fields so the stack file reuses them unchanged)

- [ ] **Step 1: Write `deployment/scripts/build-images.sh`**

Sequential `docker build` for the four repos with the tags above (`-f`/context per repo dir under `/Users/filipshramko/projects/maxit/`). `set -euo pipefail`, one `echo` per image, non-zero exit on any failure.

- [ ] **Step 2: Run it**

Run: `bash deployment/scripts/build-images.sh`
Expected: 4 images in `docker images` with the exact tags. Note build failures verbatim (e.g. frontend `pnpm install` network, Go version floors) — a failing image build is a report finding, fix inside the repo only if trivial.

- [ ] **Step 3: Verify runtime images are pullable**

Run: `docker pull ghcr.io/mini-maxit/runtime-cpp:latest` and `docker pull ghcr.io/mini-maxit/runtime-python-<ver>:latest` for one version listed in `worker/pkg/languages/languages.go` `LanguageVersionMap`
Expected: pulls succeed (public GHCR). If private → finding: worker `EnsureImage` will fail at eval time.

- [ ] **Step 4: Commit**

```bash
git add scripts/build-images.sh
git commit -m "chore: add swarm image build script"
```

---

### Task 2: Swarm stack file

**Files:**
- Create: `deployment/docker-swarm/maxit-stack.yaml`
- Modify: none (compose files stay for dev use)

**Interfaces:**
- Consumes: service images from Task 1; env contract from `backend/internal/config/config.go`, `file-storage/internal/config/config.go`, `worker/pkg/constants/constants.go`
- Produces: stack deployable with `docker stack deploy -c deployment/docker-swarm/maxit-stack.yaml maxit`; service DNS names `nginx`, `backend`, `frontend`, `file-storage`, `rabbitmq`, `db`, `worker` on the stack overlay network

- [ ] **Step 1: Write `deployment/docker-swarm/maxit-stack.yaml`**

Port `deployment/docker-compose/docker-compose.yaml` with these swarm-required changes (each is a known compose→swarm break):
- `depends_on:` — delete everywhere (swarm ignores it; readiness handled by `deploy-stack.sh` waits).
- `file-storage-media` and `pgdata` volumes: drop `driver_opts` bind-mount blocks (relative `device: ./volumes/...` named-volume binds break on swarm) → plain named volumes. `jobs-data` stays a plain named volume.
- `nginx` is the ONLY service with `ports:` (`80:80`, `443:443`). All other `ports:` blocks deleted. `file-storage` gets `expose: [8888, 8080]` semantics via network only (no host publish of internal 8080 — Global Constraint).
- nginx mounts `deployment/nginx/conf/nginx.swarm-e2e.conf` — for the initial deploy use a config **resource baked into the image or an external config**; simplest swarm-safe path: build nginx test config into a tiny image OR bind the absolute host path `/Users/filipshramko/projects/maxit/deployment/nginx/conf/nginx.swarm-e2e.conf` (single-node swarm: host path bind is valid). Use the absolute host path; note it as single-node-only.
- worker mounts `/var/run/docker.sock:/var/run/docker.sock` (host path binds are valid in stack files).
- `JOBS_DATA_VOLUME=maxit_jobs-data` (stack name prefix; Global Constraint).
- Set explicitly: `JWT_SECRET_KEY=maxit-e2e-jwt-secret`, backend `COOKIE_SECURE=true`, `CORS_ALLOWED_ORIGINS=${BASE_URL}` (substitute at deploy time via `envsubst` in `deploy-stack.sh`), `FILE_STORAGE_HOST=file-storage`, `FILE_STORAGE_PORT=8080`, `FILE_STORAGE_PUBLIC_URL=${BASE_URL}/files`, file-storage `SIGNING_SECRET=maxit-e2e-signing-secret`, `PUBLIC_SERVER_PORT=8888`, `INTERNAL_SERVER_PORT=8080`, `MAX_SIGN_TTL_SECONDS=3600`, frontend `PUBLIC_BACKEND_API_URL=${BASE_URL}/api/v1`, `ORIGIN=${BASE_URL}`, `BODY_SIZE_LIMIT=20M`, rabbitmq + worker queue envs as in compose.
- `deploy: replicas: 1` + `restart_policy: condition: any` on every service (swarm replacement for `restart: unless-stopped`).
- `db` keeps its `pg_isready` healthcheck (healthchecks work in swarm).

- [ ] **Step 2: Validate syntax without deploying**

Run: `BASE_URL=https://example.ngrok-free.app envsubst < deployment/docker-swarm/maxit-stack.yaml | docker stack config -c -` (or `docker compose -f ... config` fallback if `stack config` unavailable on this engine)
Expected: resolved config printed, no schema errors; volumes have no `driver_opts`; only nginx has `ports`.

- [ ] **Step 3: Commit**

```bash
git add docker-swarm/maxit-stack.yaml
git commit -m "feat: add swarm stack definition for e2e verification"
```

---

### Task 3: ngrok tunnel + deploy scripts

**Files:**
- Create: `deployment/scripts/start-ngrok.sh`, `deployment/scripts/deploy-stack.sh`, `deployment/scripts/teardown.sh`
- Create: `deployment/nginx/conf/nginx.swarm-e2e.conf`

**Interfaces:**
- Consumes: stack file from Task 2
- Produces: `BASE_URL` (ngrok HTTPS domain) exported to the caller; all six services healthy behind it

- [ ] **Step 1: Write `deployment/nginx/conf/nginx.swarm-e2e.conf`**

Copy of `deployment/nginx/conf/nginx.local.conf` with the redirect removed: single `server { listen 80; }` carrying the same `/api/` → `backend:8000`, `/files/` (GET-only, strip `/files` prefix) → `file-storage:8888`, `/` → `frontend:3000`, `/health` blocks. Keep `client_max_body_size 25m` and proxy headers as-is.

- [ ] **Step 2: Write `deployment/scripts/start-ngrok.sh`**

Start `ngrok http http://localhost:80` in the background (config file or flags), poll `http://localhost:4040/api/tunnels` until the HTTPS public URL appears, export `BASE_URL` (strip trailing slash) and write it to `deployment/e2e/.env`. Exit non-zero if tunnel absent after 30s. Prefer a **reserved ngrok domain** via `--domain` if `NGROK_DOMAIN` env is set (stable URL across runs); otherwise use the randomly assigned URL and print it.

- [ ] **Step 3: Write `deployment/scripts/deploy-stack.sh`**

Read `BASE_URL` (arg or env), `envsubst` the stack file (substituting `BASE_URL`), `docker stack deploy -c - maxit`, then wait loop (≤ 120s): `curl -fsS $BASE_URL/health` → nginx up; `curl -fsS $BASE_URL/api/v1/status` → backend up (auth-gated response acceptable, connection refused is not); log `docker stack ps maxit --no-trunc` on timeout.

- [ ] **Step 4: Write `deployment/scripts/teardown.sh`**

`docker stack rm maxit`, wait for services gone, kill ngrok (PID file written by start-ngrok.sh). `--purge-volumes` flag drops `maxit_*` volumes for a clean re-run.

- [ ] **Step 5: Wire up and smoke the tunnel end to end**

Run: `bash deployment/scripts/start-ngrok.sh && BASE_URL=$BASE_URL bash deployment/scripts/deploy-stack.sh`
Expected: all 7 services `Running` in `docker stack ps maxit`; `curl $BASE_URL/health` → `nginx healthy`. If rabbitmq/backend crash-loop → Review Focus #1 (guest login) or missing env; fix in stack file, redeploy.

- [ ] **Step 6: Commit**

```bash
git add scripts/start-ngrok.sh scripts/deploy-stack.sh scripts/teardown.sh nginx/conf/nginx.swarm-e2e.conf
git commit -m "feat: ngrok-backed swarm deploy scripts"
```

---

### Task 4: API test harness + J1 auth journey

**Files:**
- Create: `deployment/e2e/package.json`, `deployment/e2e/helpers/env.mjs`, `deployment/e2e/helpers/api-client.mjs`
- Test: `deployment/e2e/journeys/auth.test.mjs`

**Interfaces:**
- Consumes: `BASE_URL` from `deployment/e2e/.env`
- Produces: `api-client.mjs` exports `createClient(baseUrl)` → `{ register(user)`, `login(email, password)`, `me()`, `refresh()`, `logout()`, `changePassword(old,new) }`; `helpers/env.mjs` exports `BASE_URL`, `TEACHER`, `STUDENT`, `ADMIN` credential fixtures. Journey tests import these (Tasks 5–6 rely on the names).

- [ ] **Step 1: Write the failing J1 test**

`journeys/auth.test.mjs` using `node:test` + `assert/strict` (U13 + auth lifecycle):
1. `register` student fixture → 2xx, response has `accessToken` (per `routes/auth.go` `AuthResponse`) and `Set-Cookie: refresh_token` with `HttpOnly` + `Secure`.
2. `login` same user → 2xx + fresh tokens.
3. `GET /api/v1/users/me` with bearer → 2xx, username matches fixture.
4. `POST /api/v1/refresh` with cookie → new `accessToken`.
5. `POST /api/v1/users/{id}/password` → old→new, `login` with new password succeeds.
6. `POST /api/v1/logout` → subsequent refresh fails (401).
7. `register` duplicate username/email → 4xx.

- [ ] **Step 2: Run it — expect failures against wiring gaps**

Run: `cd deployment/e2e && node --test journeys/auth.test.mjs`
Expected first run: reachability works (Task 3 done) but failures wherever request shapes don't match backend schemas — read `backend/package/domain/schemas` + `routes/auth.go` register/login request structs and align the client exactly. Re-run until green.

- [ ] **Step 3: Commit**

```bash
git add package.json helpers journeys/auth.test.mjs .env.example
git commit -m "test: auth journey J1 against swarm domain"
```

---

### Task 5: Core journeys J2 (teacher), J3 (student), J4 (admin)

**Files:**
- Create: `deployment/e2e/journeys/teacher-setup.test.mjs`, `deployment/e2e/journeys/student-run.test.mjs`, `deployment/e2e/journeys/admin.test.mjs`
- Modify: `deployment/e2e/helpers/api-client.mjs` (add journey verbs)

**Interfaces:**
- Consumes: `createClient` from Task 4; role fixtures
- Produces: shared fixture state via a small `helpers/fixtures.mjs` (created user ids, `taskId`, `contestId`) so J3 reuses J2's world when run in order (`node --test journeys/` runs files serially per file; use a JSON fixture file written by J2 and read by J3)

- [ ] **Step 1: Role bootstrap helper**

No self-serve admin exists (register sets default role; `UserEdit.Role` needs an admin already). Add `helpers/fixtures.mjs` with `bootstrapAdmin(client)` that registers a user then promotes via direct SQL through the db service (`docker exec $(docker ps -qf name=maxit_db) psql -U postgres -d maxit -c "UPDATE users SET role='admin' WHERE id=..."`) — acceptable test-env bootstrap, marked as such in `report.md`. Verify the exact role column values from `backend/package/domain/types` before writing SQL.

- [ ] **Step 2: Write failing J2 (teacher)**

`teacher-setup.test.mjs` (T1–T4, T8 + U8 approval half):
1. Login teacher (promoted via Step 1) → `POST /api/v1/tasks` create task with description + test cases (request shape: `backend/package/domain/schemas` task structs; test cases ride the create payload or multipart — mirror `routes/tasks_management.go` handler input).
2. `POST /api/v1/groups` + `POST /api/v1/groups/{id}/users` add student fixture.
3. `POST /api/v1/contests` with start=now−5m, end=now+1h (active immediately) + `POST /api/v1/contests/{id}/tasks` assign task.
4. Student registers: `POST /api/v1/contests/{id}/registration-requests` (or whatever `routes/contests.go` exposes for self-registration — read the handler), teacher `POST .../registration-requests/{user_id}/approve` → 2xx.
5. Teacher `PUT /api/v1/contests/{id}` shifts end time (T8) → 2xx.

- [ ] **Step 3: Write failing J3 (student)**

`student-run.test.mjs` (U1–U12 core loop, sequential):
1. `GET /api/v1/tasks/my` + `GET /api/v1/tasks` → task visible (U1, U6).
2. `GET /api/v1/contests`, `GET /api/v1/contests/my`, `GET /api/v1/contests/my/active` → contest listed (U7, U9, U10).
3. `GET /api/v1/submissions/languages` → language ids to submit.
4. `POST /api/v1/submissions/submit` multipart solution file (valid small program for the task's language) → 2xx + submission id.
5. Poll `GET /api/v1/submissions/{id}` ≤ 120s → terminal verdict + per-test results (U3) — **this is the full worker/RabbitMQ/Docker chain; on failure capture worker container logs verbatim into the report** (Review Focus #2).
6. Assert any returned file URL: string starts with `$BASE_URL/files/` **and** `GET` it over the domain → 200 (Review Focus #3 and #5).
7. `GET /api/v1/submissions/my`, `GET /api/v1/submissions/tasks/{id}` → history entries (U4, U5).
8. Contest ranking/stats endpoints (U11): `GET /api/v1/contests/{id}/user-stats` with teacher or student token per access rules in `routes/contests_management.go`.

- [ ] **Step 4: Write failing J4 (admin)**

`admin.test.mjs` (A1–A2):
1. `GET /api/v1/status` + `GET /api/v1/queue/status` → healthy (A1; `routes/workers.go`).
2. `PUT /api/v1/users/{id}` promote/demote role → `GET /api/v1/users/{id}` reflects change (A2).
3. Negative: student token on teacher-only route (e.g. `POST /api/v1/tasks`) → 403 (access control; `routes/access_control.go`).

- [ ] **Step 5: Run the journey suite**

Run: `cd deployment/e2e && node --test journeys/`
Expected: all four files green. Failure triage order: request shape mismatches (fix client) → 403s (fixture roles) → submission stuck pending (worker logs → Review Focus #2). Record every non-trivial fix as a finding.

- [ ] **Step 6: Commit**

```bash
git add journeys helpers
git commit -m "test: teacher/student/admin journeys against swarm domain"
```

---

### Task 6: UI journeys (Playwright)

**Files:**
- Create: `deployment/e2e/ui/login.spec.mjs`, `deployment/e2e/ui/student-submit.spec.mjs`, `deployment/e2e/ui/teacher-contest-editor.spec.mjs`, `deployment/e2e/playwright.config.mjs`

**Interfaces:**
- Consumes: fixtures from Task 5 (`helpers/fixtures.mjs`), `BASE_URL`
- Produces: `npm run test:ui` green headless-chromium run — the thesis UI flows (screenshots in `Engineering-Thesis/frontend-screenshots/`): student task-solving split view + submission results view + teacher contest editor

- [ ] **Step 1: Add Playwright dev dependency + config**

`playwright.config.mjs`: `use: { baseURL: process.env.BASE_URL }`, chromium only, headless. `npx playwright install chromium`.

- [ ] **Step 2: Write failing `ui/login.spec.mjs`**

Open `$BASE_URL` → login form (route/labels from `frontend-2.0/src/routes` auth pages and `messages/` i18n files — read them for selectors; prefer role-based locators) → login with student fixture → lands on authenticated dashboard; logout works.

- [ ] **Step 3: Write failing `ui/student-submit.spec.mjs`**

Login student → navigate to the J2 task's solving view (split pane: task statement + submission controls) → upload solution file via the submit form → poll until results view shows verdict + per-test status chips (matches `frontend-screenshots/submission_details.png`).

- [ ] **Step 4: Write failing `ui/teacher-contest-editor.spec.mjs`**

Login teacher → open contest editor for J2 contest (time limits + task set controls per `frontend-screenshots/teacher_contest_edit.png`) → edit end time → save → toast/success state.

- [ ] **Step 5: Run UI suite**

Run: `cd deployment/e2e && BASE_URL=$BASE_URL npx playwright test`
Expected: 3 specs green headless. Frontend crashes surface here as blank pages — capture `page.on('console')` errors into the report.

- [ ] **Step 6: Commit**

```bash
git add ui playwright.config.mjs package.json
git commit -m "test: playwright UI journeys for student/teacher flows"
```

---

### Task 7: Repo-native test suites

**Files:**
- Create: `deployment/scripts/run-repo-suites.sh`
- Test: none (runs existing suites)

**Interfaces:**
- Consumes: test entrypoints — backend `go test ./...`, file-storage `go test ./...`, worker `run_integration_tests.sh` + `run_e2e_tests.sh` (own docker-compose harness; ports don't clash with the stack since only nginx publishes), frontend `pnpm check` + `pnpm lint`
- Produces: pass/fail matrix for `report.md`

- [ ] **Step 1: Write `deployment/scripts/run-repo-suites.sh`**

Runs each suite from its repo dir, captures exit codes + tail of output into `deployment/e2e/logs/repo-suites/*.log`, prints a summary table, exits non-zero if any failed. Worker e2e uses its harness as-is (its `docker-compose up` rabbit/file-storage are separate from the swarm stack; note runs must not hold ports the stack needs — stack needs only 80/443, so overlap is fine).

- [ ] **Step 2: Run it**

Run: `bash deployment/scripts/run-repo-suites.sh`
Expected: summary table. Pre-existing failures are findings, not blockers — record verbatim (worker e2e on macOS needs `DOCKER_HOST` detection it already handles).

- [ ] **Step 3: Commit**

```bash
git add scripts/run-repo-suites.sh
git commit -m "chore: repo test suite runner"
```

---

### Task 8: Localhost-leak audit + final report

**Files:**
- Test: `deployment/e2e/leak-audit.test.mjs`
- Create: `deployment/e2e/report.md`

**Interfaces:**
- Consumes: everything above
- Produces: the two deliverables the user asked for: (1) verdict "works on swarm" with journey matrix, (2) exact endpoint exposure answer

- [ ] **Step 1: Write `leak-audit.test.mjs`**

Crawl `$BASE_URL`: fetch `/` HTML, extract same-origin script/src+href URLs, fetch each JS bundle; fetch one signed file URL from J3 fixtures. Assert **zero** matches for `localhost|127\.0\.0\.1|0\.0\.0\.0` (paraglide runtime's internal URL defaults are fine — they never ship in served output; if bundles legitimately contain the string in dead code, allowlist that exact file+pattern and justify in the report). Additionally assert every absolute URL served points at the ngrok domain or a relative path.

- [ ] **Step 2: Sweep service configs + logs**

Run: `docker service logs`/`docker logs` for each stack service, grep for `localhost|127.0.0.1`; grep rendered stack env (`docker inspect` on services). Every hit classified: harmless default (Go stdlib listen `0.0.0.0`) vs config leak (URL values).

- [ ] **Step 3: Write `deployment/e2e/report.md`**

Contents:
1. **Endpoint exposure answer:** exactly one public entrypoint — nginx on 80/443 of one domain; routing table `/api/` → backend, `/files/` → file-storage (public, signed GET-only), `/` → frontend, `/health`; everything else (file-storage internal :8080, rabbitmq, postgres, worker) unreachable externally. Swarm production note: same topology on the ingress mesh; optionally front with Traefik/ingress LB — but zero additional public endpoints required.
2. **Journey matrix:** J1–J4 + UI specs × pass/fail with notes (map rows to U1–U13, T1–T14, A1–A2).
3. **Swarm findings:** every issue found (bind-mount volume break, guest/rabbit, JOBS_DATA_VOLUME prefix, JWT secret empty in compose, `depends_on` semantics, host-path assumptions) with status fixed-in-test-env vs needs-prod-decision.
4. **Localhost audit result.**
5. **Repo suite results** (Task 7).

- [ ] **Step 4: Commit + hand the report to the user**

```bash
git add leak-audit.test.mjs report.md
git commit -m "docs: swarm e2e verification report"
```

---

## Self-review notes

- **Spec coverage:** single-domain endpoint answer → Task 8 (+ stack file proves it); swarm readiness → Tasks 2–3; login/register → J1; student journeys U1–U13 → J3 (+ J2 registration approval, U8 shared); teacher T1–T14 subset exercised: T1–T4, T8 explicitly; T5/T11/T14 (stats) → J3 step 8 + accessible in J2 extensions; T6/T7/T9/T10 destructive edits intentionally smoke-level (create+delete task/contest, edit group) — added where cheap in J2; admin A1–A2 → J4. UI side mirrors thesis screenshots (3 key screens) — full UI matrix out of scope, API matrix is the coverage backbone.
- **Step scan:** request shapes deliberately point at backend schema files instead of transcribing structs — implementer reads authoritative source; no step leaves a decision that the specs/tests don't pin.
- **Type consistency:** `createClient`, fixture names, `BASE_URL` consistent across Tasks 4–6, 8.
- **Review Focus:** five items each mapped to owning task step.
- **Proportion:** plan is scaffolding + verification commands; no code bodies transcribed.

**Known open points for the builder (resolve during execution, record in report):**
- Register request/response shape (exact JSON) — read `routes/auth.go` + `package/domain/schemas` before writing the client.
- Test-case upload transport on task create (JSON payload vs multipart) — `routes/tasks_management.go` handler decides.
- Role column values in SQL bootstrap — `package/domain/types` `UserRole`.
- ngrok reserved domain availability (`NGROK_DOMAIN`) — random URLs acceptable, but frontend caches/config reload not needed since envs are runtime.
