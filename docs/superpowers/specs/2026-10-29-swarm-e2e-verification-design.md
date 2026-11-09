# Swarm E2E Verification — Design

## Intent

Prove the maxit application works end to end when deployed as a Docker Swarm stack, and prove it runs correctly behind exactly one public domain — with zero `localhost` references in runtime configuration or served content. Deliver a precise answer for how many endpoints must be publicly exposed.

## Why now

Deployment target is Docker Swarm in production. The existing `docker-compose/docker-compose.yaml` contains compose-only constructs that break under `docker stack deploy`, and current URLs are configured for `mini-maxit.pl`/localhost mixes. Testing must run over a real public domain (ngrok) so hidden localhost dependencies cannot survive.

## Goals

- All 6 services (frontend, backend, file-storage, worker, rabbitmq, db) run as a swarm stack behind nginx, which is the only published service.
- User journeys verified from the Engineering-Thesis requirements: Student/User U1–U13, Teacher T1–T14, Admin A1–A2 — API-level journeys as the coverage backbone, Playwright UI journeys for the three thesis core screens (login, student submit+results, teacher contest editor).
- Login/register verified explicitly (U13 + auth lifecycle incl. refresh-cookie flow over HTTPS).
- Localhost-leak audit over the public domain: HTML, JS bundles, API responses, signed file URLs, service logs, rendered service envs.
- Repo-native suites run as additional verification (backend, file-storage, worker, frontend check/lint).
- Report: endpoint exposure answer + journey matrix + swarm findings.

## Non-goals

- Multi-node swarm behavior (single-node Docker Desktop only; host-path binds and node-local volumes are acceptable here).
- Production hardening of secrets (test literals fine), backups, monitoring.
- Full UI test matrix (API journeys carry requirement coverage; UI covers the three core screens).
- Changing application source in backend/frontend-2.0/file-storage/worker (deployment repo artifacts only). Test-env bootstraps (SQL role promotion) allowed but must be reported.

## Anti-goals

- Leaking internal services (file-storage :8080, rabbitmq, postgres) to the host or the public domain.
- Any app-configured URL pointing at localhost/internal hostnames in served output.
- Shipping signed URLs that only work from inside the docker network.

## Constraints

- Single public domain via ngrok; all app URLs (`FILE_STORAGE_PUBLIC_URL`, `PUBLIC_BACKEND_API_URL`, `ORIGIN`, `CORS_ALLOWED_ORIGINS`) = `$BASE_URL`-derived.
- Stack name `maxit` (worker `JOBS_DATA_VOLUME=maxit_jobs-data` depends on the prefix).
- Only nginx publishes host ports (80, 443).
- Platform: macOS Docker Desktop, single-node swarm, Node ≥ 22, Go toolchains per repo.

## Decided how (as decided with the user)

- Test on real swarm mode locally, not plain compose (user: "run all e2e tests on docker swarm locally").
- Extend with ngrok as the domain to prove no localhost references survive (user directive).
- Journey coverage = teacher + student perspectives per thesis docs, plus login/register (user directive; thesis use-case diagrams + functional-requirements table are the journey source).
- Execution: native/inline (user choice at plan handoff).

## Left to the builder

- Exact request shapes for register/login/task-create/test-case transport (read backend schemas/routes).
- Role bootstrap mechanics (SQL promotion acceptable; report it).
- ngrok reserved vs random domain (random acceptable).
- RabbitMQ guest cross-container access handling (set default user if loopback-restricted).
