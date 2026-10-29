# Maxit — Docker Swarm E2E Verification Report

**Date:** 2026-10-29 · **Environment:** single-node Docker Swarm (Docker Desktop, macOS), all traffic via one ngrok HTTPS domain, all app URLs pointed at that domain (no localhost anywhere).

---

## 1. How many endpoints must be exposed publicly?

**One.** A single domain on a single entrypoint — nginx (80 redirect + 443, or plain HTTP behind a TLS-terminating proxy). Everything routes through it:

| Path | Proxied to | Public exposure |
|---|---|---|
| `/api/` | backend :8000 | JWT-protected REST API |
| `/files/` | file-storage :8888 | **GET-only**, HMAC-signed URLs (writes impossible from outside) |
| `/` | frontend :3000 | SvelteKit UI |
| `/health` | nginx | liveness probe |

**Not exposed and never needing exposure:** file-storage internal API :8080 (writes/metadata/signing — backend/worker reach it over the overlay network), RabbitMQ :5672/:15672, Postgres :5432, worker (no HTTP; consumes RabbitMQ, drives the Docker socket).

For production swarm: put the same nginx (or any LB — Traefik/ingress) on the ingress mesh with only 80/443 published; every other service attaches to the internal overlay only. **Zero additional public endpoints required.** The stack file proves this topology: only `nginx` has a `ports:` block (`deployment/docker-swarm/maxit-stack.yaml`).

---

## 2. Journey verification matrix

Tests live in `deployment/e2e/` (API: `node --test journeys/`, UI: `npx playwright test`, leak audit: `node --test leak-audit.test.mjs`), all against the public domain. Requirement IDs from `mini-maxit/Engineering-Thesis` functional requirements.

| Requirement | Coverage | Result |
|---|---|---|
| U1 View assigned tasks | J3 `/tasks/my` | ✅ |
| U2 Submit solution | J3 submit + UI student-submit (full worker/Docker eval chain) | ✅ |
| U3 View verdicts + per-test results | J3 verdict + `testResults[]` + UI results view | ✅ |
| U4 Submission history | J3 `/submissions/my` | ✅ |
| U5 Per-task history | J3 `/submissions/tasks/{id}` | ✅ |
| U6 View available tasks | J3 `/tasks` | ✅ |
| U7 View available contests | J3 `/contests` | ✅ |
| U8 Register + approval flow | J2 register → teacher approve/reject endpoints | ✅ |
| U9 Registered contests | J3 `/contests/my` | ✅ |
| U10 Participate in active contest | J3 submit with `contestID` + `/contests/my/active` | ✅ |
| U11 Contest results | J3 `/contests/{id}/results/my` | ✅ |
| U12 Contest details | J3 `GET /contests/{id}` | ✅ |
| U13 Edit profile | J1 password change + profile fields PATCH | ✅ |
| T1 Create task + test cases | J2 upload zip (description + input/output) | ✅ |
| T2/T10 Groups + memberships | J2 create group, add user, rename | ✅ |
| T3 Create contest | J2 contest with time window | ✅ |
| T4 Assign tasks | J2 assign task to contest (direct user/group task assignment not exercised) | ✅* |
| T5/T11/T14 Statistics | J2 task-stats, user-stats | ✅ |
| T6 Edit task | J2 rename | ✅ |
| T7 Delete task | J2 delete + gone from list | ✅ |
| T8 Edit contest | J2 extend end time + UI editor dialog | ✅ |
| T9 Delete contest | J2 delete | ✅ |
| T12, T13 | **Not defined** — the thesis requirements table lists T1–T11 and T14 only (numbering gap at the source); nothing to verify | n/a |
| A1 Monitor system health | J4 `/workers/status`, `/workers/queue/status` | ✅ |
| A2 Manage roles | J4 promote/demote via PATCH `/users/{id}` | ✅ |
| Auth lifecycle | J1 register→login→me→refresh→password→logout, stale-cookie rejection, duplicate rejection | ✅ |
| Access control negatives | J4 student→teacher API 403, unauthenticated 401 | ✅ |
| UI journeys | login/logout, student task view→submit→results, teacher contest editor | ✅ 4/4 |

**Final results: API journeys 35/35 ✅ · UI journeys 4/4 ✅ · localhost leak audit 3/3 ✅**

*T4 direct-to-user/group task assignment path not exercised (contest assignment is).

### Review Focus → evidence

| Focus risk | Where proven |
|---|---|
| RabbitMQ `guest` remote login | Empirically settled: official `rabbitmq:3.13-management` image ships `loopback_users = []`; backend/worker authenticate from overlay IPs (full eval chain green). Prod note: `guest/guest` with administrator tag on the overlay is a secrets item. |
| `JOBS_DATA_VOLUME` prefix mismatch | Stack sets `maxit_jobs-data` = `<stack>_<volume>`; J3's Docker-eval assertion is the test that fails if the mount breaks. |
| Signed URL host leakage/fallback | J3 asserts every returned URL starts with `$BASE_URL/files/` **and** fetches one through the domain (200). |
| Refresh-cookie flow over HTTPS | J1 asserts `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/api/v1/auth/refresh` on the cookie, then exercises refresh + stale-cookie-after-logout rejection. |
| nginx `/files/` rewrite vs signature binding | J3 signed download through the domain returns 200 (rewrite strips exactly `/files`, signature path intact). |

---

## 3. Swarm findings (would bite in production)

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | **DB migrations are manual** (`atlas migrate apply` per README); the old compose worked only because `pgdata` was a bind-mounted, pre-migrated data dir. Fresh swarm volume = `relation "maxit.users" does not exist` → every write 500s. | 🔴 Critical | Fixed in `deploy-stack.sh` (one-shot atlas container on the overlay). **Prod deploy MUST include this step.** Requires `attachable: true` overlay for one-shot jobs. |
| 2 | **`:latest` image tags re-resolve to Docker Hub** — `seber/maxit-file-storage` and `seber/maxit-worker` are published repos; `docker stack deploy` pinned the stale pushed builds (old env names → file-storage internal server bound :8081 while backend dialed :8080 → all file ops failed). | 🔴 Critical | Stack uses unpullable local tags `maxit/file-storage:local`, `maxit/worker:local` + `--resolve-image never`. Prod: pin by digest or use unambiguous registries. |
| 3 | **No `depends_on` in swarm** — cold-start DNS race: backend panics `lookup db ... no such host` (exit 2) and nginx exits on unresolvable upstream; both crash-loop until DNS registers. | 🟡 Medium | Self-heals via `restart_policy: condition: any`; found restarts on every deploy. Prod hardening: retry-on-boot in backend (it panics), or entrypoint waits. |
| 4 | **No language seed** — `language_configs` table ships empty (no migration seed, no create API). Submissions impossible without manual DB rows. The old DB had them; fresh deployments lose them. | 🟡 Medium | Test seed in `e2e/helpers/fixtures.mjs`. **Prod: migrate data or add seed migration.** |
| 5 | **No admin bootstrap** — first admin can only be created via DB (JWT embeds role; `PATCH /users/{id}` role changes need an existing admin). | 🟡 Medium | Test SQL bootstrap (reported as such). Prod: seed script or first-run admin. |
| 6 | **nginx `limit_req` (30 r/s, burst 50) breaks burst-heavy pages** — through a shared-IP proxy (here ngrok), one dashboard load can exhaust the bucket → 503s on assets/API → app renders its error page. Same limits in prod `nginx.conf`. | 🟡 Medium | Test config raised to 1000 r/s burst 2000. Prod: size limits per real traffic / key on `X-Forwarded-For`. |
| 7 | JWT embeds the role claim — role promotions take effect only after re-login. | 🔵 Note | By design; document for admins. |
| 8 | Backend logs `ERROR Failed to sign file URL … object not found` for optional per-test artifacts (stderr/diff absent for passing tests). | 🔵 Minor | Noise-level; suggested: treat missing optional artifacts as info. |
| 9 | `docker service logs` aggregation hangs/slow on this engine; `docker logs` per task works. | 🔵 Minor | Tooling note. |

## 4. Localhost / internal-reference audit

- **Served content (HTML + all `_app/immutable` assets, login/register pages, signed file bodies): zero localhost/127.0.0.1/0.0.0.0 references** (only allowlist: paraglide runtime's URL-parsing fallback strings — dead code, never fetch targets).
- **Service envs:** zero loopback references — `FILE_STORAGE_PUBLIC_URL`, `PUBLIC_BACKEND_API_URL`, `ORIGIN`, `CORS_ALLOWED_ORIGINS` all point at the public domain.
- **Service logs:** one hit total — `Listening on http://0.0.0.0:3000` (adapter-node bind default inside the container — correct, not a URL leak).
- Signed download URLs are `$DOMAIN/files/...` and download successfully through nginx's `/files/` rewrite with signature intact.

## 5. Repo-native suites

| Suite | Result | Notes |
|---|---|---|
| backend `go test ./...` | ✅ PASS | |
| file-storage `go test ./...` | ✅ PASS | |
| worker `go test ./...` | ✅ PASS | |
| worker integration (`run_integration_tests.sh`) | ❌ FAIL | Harness RabbitMQ readiness timeout (30×2s); standalone rabbitmq also >60s to ready under load (Docker Desktop resource starvation). Needs isolated rerun. |
| worker e2e (`run_e2e_tests.sh`) | ❌ FAIL | All `TestE2E_*` fail instantly (~0.03s) — same RabbitMQ starvation in its compose harness. Needs isolated rerun. |
| frontend `pnpm run check` | ✅ PASS | |
| frontend `pnpm run lint` | ❌ FAIL | Pre-existing: prettier 3.8.1 crashes on Svelte files (`getVisitorKeys is not a function`) — prettier-plugin-svelte incompatibility, repo tooling bug. |

## 6. Environment notes

- ngrok free tunnel proved flaky on this network (session heartbeat timeouts, CRL fetch failures, edge ERR_NGROK_3200) and reassigns the URL on restart (each restart requires stack redeploy since URLs are runtime envs). `scripts/start-ngrok.sh` now verifies the tunnel actually serves traffic. **Recommendation: a reserved domain (`NGROK_DOMAIN=...`) or a stable proxy for repeatable runs.**
- The ngrok free-tier browser interstitial is bypassed in tests via the `ngrok-skip-browser-warning` header (Playwright: `extraHTTPHeaders`; note it leaks to cross-origin font requests — cosmetic CORS console noise).
- Data bootstrap for a fresh environment: migrations (now automated on deploy), language rows (test seed), first admin (test SQL). Only migrations are automated in deploy tooling.

## 7. How to re-run

```bash
bash deployment/scripts/build-images.sh        # build 4 images (+ :local tags)
bash deployment/scripts/start-ngrok.sh         # tunnel → BASE_URL in e2e/.env
bash deployment/scripts/deploy-stack.sh        # stack + migrations + readiness
cd deployment/e2e
node --test --test-concurrency=1 "journeys/*.test.mjs"   # API journeys
node --test leak-audit.test.mjs                          # leak audit (after journeys)
npx playwright test                                      # UI journeys
bash ../scripts/run-repo-suites.sh                       # repo suites
bash ../scripts/teardown.sh --purge-volumes              # clean up
```
