# PLAN - the Self-hosted Server

The backend half of M5 in the frontend's [`PLAN.md`](../ni-dip-fe/PLAN.md).
Scoped by a `/grill-with-docs` session on 2026-09-28.
Product decisions taken as given: frontend ADR 0017 (conflict model), 0018 (the server serves the PWA), 0020 (the `Remote` and `AccountService` seams), the thesis ADR 0002 (bytes are files on disk), and [`../ni-dip-fe/docs/architecture/04-sync.md`](../ni-dip-fe/docs/architecture/04-sync.md) and [`05-server.md`](../ni-dip-fe/docs/architecture/05-server.md).
Decisions made here: [`docs/adr/`](./docs/adr/) 0001 to 0004.
Vocabulary: [`CONTEXT.md`](./CONTEXT.md), with product terms canonical in [`../ni-dip-fe/CONTEXT.md`](../ni-dip-fe/CONTEXT.md).

## Decided

### Toolchain
- Node 24 LTS, pnpm via corepack, TypeScript strict, Biome, Vitest.
  The same as the frontend so one person can move between the repos.
- `better-sqlite3` behind Drizzle.
  A single-executable build is future work, not started; `node:sqlite` behind the same Drizzle schema is the path if it ever is.

### What a contributor can change, and how
| Change | Mechanism |
|---|---|
| Paths, port, page size, tombstone window, session TTL, body limits, log level | `src/config.ts`: env vars with Zod-validated defaults, documented in `compose.yml` |
| The database engine | Drizzle is the seam; the schema is portable, the product ships SQLite and its docs assume it |
| Where bytes live | `BlobStore` interface: disk (default) and memory (tests), one contract test suite |
| The sync rules | `src/sync/`: pure functions over rows, no HTTP, no Drizzle |

No repository layer, no pluggable strategies: an interface exists only where a second implementation does.

### Contract and API docs
- `src/contract/index.ts` is the one shared Zod 4 file: entities, request and response schemas, the problem-details error shape.
  Browser-safe, no server imports.
- The frontend vendors it as a raw file pinned to a commit; the header comment carries that commit.
- `fastify-type-provider-zod` types the handlers; `@fastify/swagger` writes `docs/openapi.json` (committed, diffed in CI) and `@fastify/swagger-ui` serves `/api/docs`, always on, assets bundled.
  No hand-maintained Postman collection: import the OpenAPI file.

### Routes
All under `/api`; everything else is the PWA with SPA fallback.

| Area | Routes |
|---|---|
| Entry | `GET /api` (HAL root) |
| First run | `GET /api/setup`, `POST /api/setup` (404 once an Owner exists) |
| Session | `POST`, `GET`, `DELETE /api/session`; the POST accepts a password or a Pairing Code |
| Devices | `GET /api/devices`, `DELETE /api/devices/:id` |
| Pairing and Invites | `POST /api/codes` (kind `device` or `invite`), `POST /api/accounts` (spend an invite) |
| Password reset | `PUT /api/accounts/:id/password` (Owner); CLI `reset-owner-password` |
| Feed | `GET /api/changes?since=<seq>`; `_links.next` is the cursor; `ETag` on pages; `410` when the cursor predates the tombstone window |
| Push | `POST /api/changes`: the batch, one transaction, per-row outcome `accepted`, `conflict`, `gone` |
| Live Update | `GET /api/changes/stream`: SSE, `id:` is the Sequence, no payload |
| Blobs | `PUT`, `GET`, `HEAD /api/blobs/:id` |
| Health | `GET /health` |

Batch push is the only write path in M5.
Single-resource `GET`s exist as HAL link targets with an `ETag`; per-resource `PUT` with `If-Match` is additive later work.

### Security
- Session: 32 random bytes, SHA-256 in `sessions`, `HttpOnly; Secure; SameSite=Lax` cookie, one row per Device.
  JSON Web Tokens rejected (ADR 0001).
- Passwords: `scrypt` from `node:crypto`.
- Pairing Codes hashed, ten-minute expiry, single use; the Owner is created only through the code printed at first start (ADR 0001).
- CSRF: `SameSite=Lax` plus rejecting unsafe methods with `Sec-Fetch-Site: cross-site`.
- Rate limits per IP on setup, sign-in and code redemption; body limits on JSON and blobs; one SSE connection per Device.
- Four static security headers in one `onSend` hook; a real CSP is its own later task tested against the built PWA.
  `@fastify/helmet` not used.
- Container: non-root, read-only except `/data`, no published port; only Caddy is reachable.
- Same 401 and same cost for a wrong username and a wrong password.

### Data
- `DATA_DIR` holds `younotes.db` (WAL, foreign keys on, `busy_timeout`) and `blobs/<id>`; that directory is the backup unit.
- Drizzle schema in `src/db/schema.ts`; `drizzle-kit` migrations committed under `drizzle/` and applied at startup.
- Tables: `accounts` (with the Sequence counter), `sessions`, `codes`, `notes`, `tags`, `note_tags`, `tombstones`, `blobs`; later `shares`.
- Every synced row carries `rev` and `seq`; the feed is read from the rows, no change log (ADR 0002).
- Attachment metadata is a JSON column on `notes`; `blobs` records ownership and existence (ADR 0003).
- CLI `backup <dir>`: `VACUUM INTO` plus a copy of `blobs/`; no scheduler, the guide shows the cron line.

### Sync rules (`src/sync/`)
| Device sends | Server has | Outcome |
|---|---|---|
| no `rev` | nothing | `accepted`, rev 1 |
| no `rev` | the id | `conflict` |
| `rev` equal | the row | `accepted`, rev + 1, new `seq` |
| `rev` lower | the row | `conflict` with the server row; the Device makes the Conflicted Copy |
| anything | a Tombstone | `gone` |
| a Tombstone, `rev` equal | the row | row deleted, Tombstone written, blobs released to the sweep |
| a Tombstone, `rev` stale or absent | the Note or Tag | `conflict` with the server row, nothing written; a NoteTag Tombstone is always accepted |
| a NoteTag | anything | `accepted`; a link has nothing to conflict over |

One transaction per batch; a malformed row fails the whole batch with 400.
Pages default to 50 rows across the four kinds (`PAGE_SIZE`, cap 200), ordered by `seq`.
Tombstones expire after 90 days; a daily in-process sweep also removes blob files unreferenced for 24 hours.
`PUT /api/blobs/:id` writes to a temp file, verifies, moves into place; a repeat is 204 without reading the body; upload before or after the Note both work.

### Structure
```
src/
  contract/index.ts   shared Zod contract
  config.ts           env -> Config
  server.ts           buildServer(config, deps), no listen()
  main.ts             listen, migrate, print the first-run Pairing Link
  cli.ts              backup, reset-owner-password
  db/                 schema.ts, client.ts, migrate.ts
  blobs/              BlobStore.ts, disk.ts, memory.ts, blobStore.contract.test.ts
  auth/               passwords.ts, sessions.ts, codes.ts
  sync/               push.ts, pull.ts
  hal.ts
  routes/             one file per route group
  plugins/            auth.ts, static.ts, docs.ts
drizzle/              generated migrations
docs/                 openapi.json, adr/, architecture/, setup.md
```
Plugins: `fastify-type-provider-zod`, `@fastify/swagger`, `@fastify/swagger-ui`, `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit`, `@fastify/sensible`.
SSE is ~20 lines on `reply.raw`.
Logging is Fastify's pino; `pino-pretty` in dev only; `X-Request-Id` echoed.

### Testing
No mocked database: a real in-memory SQLite with migrations applied, per test file.

| Tier | Against | Share |
|---|---|---|
| API over `app.inject()` | `buildServer()`, memory SQLite, memory `BlobStore`; every response parsed with the contract schema | most |
| Unit | `sync/`, `hal.ts`, `auth/`, `config.ts` | second |
| Database | migrations from empty, schema snapshot, feed queries | small |
| `BlobStore` contract | disk (temp dir) and memory | one file |
| Container smoke | the built image in CI: `/health`, the Pairing Link in the log | one job |

### Delivery
- Pipeline `quality -> test -> build -> publish` with the SAST and secret-detection templates kept.
  `quality` also fails on a stale `docs/openapi.json` or an ungenerated migration.
- Kaniko builds the image; the Dockerfile takes the PWA from the frontend's published image, pinned by tag (ADR 0004).
- `compose.yml`: `younotes` and `caddy`; TLS modes Tailscale (happy path), own domain over HTTP-01, internal CA; `docker compose up younotes` alone for `http://localhost`.
- Tags `v0.x.y`; the image tag is the git tag; the downloaded compose file pins a version, never `latest`.
  Migrations are forward-only; downgrade is "restore the backup".

### Out of scope, deliberately
End-to-end encryption, sharing a Note into another Account, email, a WAF, a single executable, per-resource `PUT`, resumable upload, quotas.

## Slices

- [x] **B1 Skeleton**: toolchain, `config.ts`, `buildServer`, Drizzle and migrations, `BlobStore` with the contract test, hooks (auth, CSRF, headers, error shape), `/api/docs` and `docs/openapi.json`, the pipeline, Dockerfile with the frontend image stage, `compose.yml` and Caddyfile, `/health`.
  Done when `docker compose up` serves the PWA over TLS and `/api/docs` opens.
- [x] **B2 Accounts and Pairing**: `accounts`, `sessions`, `codes`; the first-run Pairing Link in the log; setup, session, devices and revoke, invites, password reset, CLI; rate limits.
  Done when a phone scans the log's QR and lands signed in, and the contract file is published for frontend slice 3.
  Deviations: `PUBLIC_URL` added so the printed link names the right origin; the `setup` code has no clock expiry (ADR 0001).
- [x] **B3 The loop**: push with the rules above, feed pages with `ETag` and `410`, SSE hints, the tombstone sweep.
  A NoteTag Tombstone's `id`, and a NoteTag push outcome's, is `<noteId>:<tagId>` (`noteTagId` in the contract).
  A Tombstone carries the `rev` the Device last agreed with, so a purge never discards a newer edit.
  Deviations: `since=0` never answers 410, because a Device starting empty cannot have missed a Tombstone and would otherwise loop on resync; a stored Tombstone's `deletedAt` is the server's clock, so a Device's clock cannot shorten the window.
  Done when frontend slice 4 runs against it and a conflict yields a Conflicted Copy on the Device.
- [x] **B4 Blobs**: the blob routes, temp-file write, orphan sweep, size caps.
  Deviations: no byte counting past Content-Length, because Node's HTTP parser already ends the body there; blob responses also send `Content-Security-Policy: default-src 'none'; sandbox`, so uploaded HTML never runs as this origin.
  Done when frontend slice 5 syncs previews and bytes.
- [ ] **B5 Setup and docs**: `docs/setup.md` (three modes, adding a phone, adding a household member, backup and restore, upgrade, Owner reset, the "your data" section, the exposure table per mode), release tagging.
  Done when a non-programmer follows the guide unsupervised in a user test.
- [ ] **B6 Share Links** (after sync works): `shares` table, mint, revoke and list routes, the unauthenticated `GET /api/shares/:token` and its blob route, the frontend `/share/$token` read-only route rendered through DOMPurify.
  Only reaches strangers in the own-domain mode; documented as such.
