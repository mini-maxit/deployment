# Production Release Design — publishing, data migration, admin file access

Date: 2026-11-02 · Status: draft (awaiting approval)

## Intent

Get maxit into production on university-hosted Docker Swarm in a way the team can repeat without host access: images published from CI to a public registry, database schema and data delivered and applied safely, and one admin capability added for file inspection. The binding constraint throughout: **no data exposure** — the old course data (PII, student uploads, secrets) must never reach a public surface: not registries, not repos, not CI logs, not unauthenticated endpoints.

## Why now

Deployment is handed to university admins via a shared swarm/compose-style file; images are pulled from public registries; the team has no shell on the host. The old Django system's operational habits (SSH + management commands) do not transfer. The old server's dataset (pg_dump + file-storage media + an old JWT key) must be migrated exactly once, correctly.

## Goals

1. **Reproducible public image publishing** — CI-built, versioned, digest-pinned images for backend, frontend, file-storage, worker; admins deploy exactly what was released.
2. **Self-contained schema migrations** — the shared stack file carries migrations; no manual step on the host.
3. **One-time data restore runbook** — documented, minimal-admin-burden procedure for the dump + media, sequenced correctly with migrations.
4. **Admin file browser** — admins can browse and download any file/folder in file storage through the app (frontend → backend → internal file-storage), admin-role gated and audited.

## Non-goals

- SSH/bastion access (deferred; re-evaluate only if incident debugging proves painful).
- Raw SQL access or external DB tooling (pgAdmin etc.). Debugging needs are met by the REST API, which exposes full data to authorized roles.
- Multi-node swarm engineering (university hosts run what the shared file declares; volumes stay node-local by design).
- Application feature work beyond the admin file browser.
- **Ongoing backups — explicitly out of scope** (partner's decision; university admins' domain).

## Anti-goals

- Data or secrets in image layers, git history, CI logs, or public registry artifacts.
- New publicly reachable services or ports beyond the single app domain.
- Raw-SQL or filesystem escape hatches reachable from the app.
- Silent `:latest` upgrades of what admins run.
- Host-path mounts in the shared stack file (admins run the file as-is).

## Constraints

- Delivery mechanism = a shared stack/compose file; admins execute it; team never touches the host directly.
- Images must be pullable from a **public** registry by the university machines.
- Dataset is three parts, all sensitive: `dump_21-02-2026-15-24.sql` (pg_dump, **already at current migration head** — `atlas_schema_revisions` matches `backend/migrations/` exactly), `file-storage-media.tar.gz` (student uploads), `env-file-do-not-leak` (old `JWT_SECRET_KEY`).
- file-storage today: public = signed GET only; internal = writes/metadata/signing. **No key-listing exists** (only bucket listing) — browser needs a small internal listing addition.

## Decided how (as agreed with the partner)

- **Registry: public GHCR** (`ghcr.io/mini-maxit/{backend,frontend,file-storage,worker}`). The stale `seber/*` Docker Hub builds are superseded, not reused. Runtime executor images already live on GHCR.
- **CI: GitHub Actions on version tags** (`vX.Y.Z`) — builds from clean source, pushes tag + git-SHA tag, prints digests. The shared stack file pins digests (`image: ghcr.io/...:vX.Y.Z@sha256:...`).
- **Migrations: one-shot `migrator` service inside the stack file** (backend image, `atlas migrate apply`, exits; deploy order before app rollout via restart policy + docs). No manual step.
- **Restore: runbook for admins** (they must handle the 117MB media anyway). Order: copy artifacts → one-shot psql restore into db volume → untar media into file-storage volume → deploy stack (migrator validates/no-ops). Done once, before first deploy.
- **JWT key: rotate.** Old key is retired (it transited a laptop). Cost = one re-login; refresh cookies expire ≤7 days. Old key must be deleted from disk after the runbook.
- **No SSH in v1.** If later needed: one dedicated hardened bastion container (key-only, network-restricted, opt-in) — never sshd inside app containers.
- **DB access = REST API as-is.** Full data is already queryable by authorized roles; no separate DB door. (If gaps appear in practice, add bounded admin views/exports later.)
- **File storage access = admin-gated browse/download**, the one new feature (below).
- **Test environments continue on synthetic seeded data only** (e2e suite already does this).
- **Topology: dual proxy.** The university's reverse proxy fronts the domain; **our own nginx stays in the stack** doing app routing (`/api/`, `/files/`, `/`). The stack publishes **one** internal port to their proxy — no public ports of our own, no host-path mounts. Our nginx config is **baked into a CI-published image** (small `nginx` variant in the same registry) so the shared file stays self-contained.
- **Artifacts (dump + media) + secrets: one encrypted bundle, channel = the lab admin's preference.** The partner asks the lab guy how he wants to receive it; until then the design default is an `age`/openssl-encrypted archive with the passphrase delivered over a separate channel. Secrets are generated at bundle time and **deleted from disk after handoff**; if the admin prefers generating host-side, the runbook switches to placeholder mode. (Partner skipped the secret-delivery question — flagged as one open dependency on the lab-guy conversation.)

## The new feature: admin file browser

Flow: frontend admin page → backend admin endpoint(s) → file-storage **internal** API. Public surface unchanged (signed GET only).

- **file-storage (internal API only):** add key listing — `GET /buckets/{bucket}/keys?prefix=&limit=` returning keys + sizes + mtimes (paginated). Public server: no change (listing must never be public).
- **backend:** admin-role endpoints (JWT + role check + audit log):
  - `GET /api/v1/admin/files?bucket=&prefix=` → listing via internal API.
  - `GET /api/v1/admin/files/download?bucket=&key=` → 302/JSON to a freshly minted signed URL (short TTL), or streamed proxy. Prefer signed-URL redirect — no double bandwidth through backend.
  - `GET /api/v1/admin/files/download-folder?bucket=&prefix=` → streamed zip of the prefix (folder download).
- **frontend:** page under `/dashboard/admin/files` — bucket/prefix tree browser, per-file download, per-folder zip download. Admin role only (consistent with existing `dashboard/admin/*` pages).
- All requests authed (admin), logged like existing routes. No anonymous path to listing.

## What's left to the builder

- Exact GHCR package visibility/settings and Actions workflow YAML (org `mini-maxit`; note GHCR public packages still need the repo linked for Actions auth).
- Baked nginx image: conf contents (dual-proxy: trust X-Forwarded-* from the university proxy, single published port), built in the same CI pipeline.
- Migrator service details: `restart_policy: condition: none`, exit-code visibility, and how the shared file documents its one-shot nature to admins. Subsequent releases with schema changes rely on apps crash-restarting until the migrator lands (verified self-healing pattern) — no deploy gating.
- Runbook wording (exact commands, psql invocation form given the dump's `\restrict` marker — restore as owner/superuser or `--no-restrict`-equivalent handling), plus the encrypted-bundle steps and post-handoff key/file deletion.
- Zip streaming implementation for folder download (memory bounds, max size).
- Whether the stale `seber/*` Docker Hub repos get an archive notice (recommended: README pointing at GHCR).
- Frontend page polish and pagination UX.

## Open dependencies (outside the builder)

- Lab admin's preferred artifact/secret delivery channel (partner to ask).
- The university proxy's expectations: hostname routing, whether TLS terminates at their edge or passes through, and which internal port to publish.
