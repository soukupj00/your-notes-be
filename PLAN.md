# PLAN - the Self-hosted Server

The backend half of M5 in the frontend repository's `PLAN.md`.
Scoped by a `/grill-with-docs` session on 2026-09-28.
Product decisions taken as given: frontend ADR 0017 (conflict model), 0018 (the server serves the PWA), 0020 (the `Remote` and `AccountService` seams), the thesis ADR 0002 (bytes are files on disk), and the frontend repository's architecture chapters `docs/architecture/04-sync.md` and `05-server.md`.
Decisions made here: [`docs/adr/`](./docs/adr/) 0001 to 0007.
Vocabulary: [`CONTEXT.md`](./CONTEXT.md), with product terms canonical in the frontend repository's `CONTEXT.md`.

## Decided

### Toolchain
- Node 24 LTS, pnpm via corepack, TypeScript strict, Biome, Vitest.
  The same as the frontend so one person can move between the repos.
- Drizzle over `better-sqlite3` (the default) or `pg` (ADR 0006); `@aws-sdk/client-s3` for S3-compatible blob storage.
  A single-executable build is future work, not started; `node:sqlite` behind the SQLite Store is the path if it ever is.

### What a contributor can change, and how
| Change | Mechanism |
|---|---|
| Paths, port, page size, tombstone window, session TTL, body limits, log level | `src/config.ts`: env vars with Zod-validated defaults, documented in `compose.yml` |
| The database | `Store` interface (ADR 0006): SQLite (default) and PostgreSQL via `DATABASE_URL`, one contract suite |
| Where bytes live | `BlobStore` interface: disk (default), S3 via `BLOB_STORE=s3`, memory (tests), one contract suite |
| Moving between backends | CLI `migrate`, through the portable Server Backup format |
| The sync rules | `src/modules/sync/decide.ts`: pure functions over rows, no HTTP, no Store |

Routes call services, services call the two interfaces, and only `src/infra/` imports a driver (ADR 0007).
One server instance; a second is refused at startup when the Store is PostgreSQL.

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
| Members | `GET /api/accounts` (Owner): every Account, with its password-reset link |
| Password reset | `PUT /api/accounts/:id/password` (Owner); CLI `reset-owner-password` |
| Feed | `GET /api/changes?since=<seq>`; `_links.next` pages and carries `from`, the pull's origin, which the 410 check judges; `_links.resume` is the cursor to keep; `ETag` on pages; `410` when the cursor predates the tombstone window |
| Push | `POST /api/changes`: the batch, one transaction, per-row outcome `accepted`, `conflict`, `gone` |
| Live Update | `GET /api/changes/stream`: SSE, `id:` is the Sequence, no payload |
| Blobs | `PUT`, `GET`, `HEAD /api/blobs/:id` |
| Share Links | `POST`, `GET /api/shares`, `GET`, `DELETE /api/shares/:id`; public, no Session: `GET /api/public/shares/:token` and `GET`, `HEAD .../blobs/:id` |
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
- By default `DATA_DIR` holds `younotes.db` (WAL, foreign keys on, `busy_timeout`) and `blobs/<id>`.
  `DATABASE_URL` moves the records to PostgreSQL and `BLOB_STORE=s3` moves the bytes to a bucket.
- One Drizzle schema per database under `src/infra/`; `drizzle-kit` migrations committed under `drizzle/sqlite/` and `drizzle/postgres/`, applied at startup.
- Timestamps are ISO 8601 text in both databases.
- Tables: `accounts` (with the Sequence counter), `sessions`, `codes`, `notes`, `tags`, `note_tags`, `tombstones`, `blobs`, `shares`.
- Every synced row carries `rev` and `seq`; the feed is read from the rows, no change log (ADR 0002).
- Attachment metadata is a JSON column on `notes`; `blobs` records ownership and existence (ADR 0003); an Attachment references its bytes by `id` and, for images, its thumbnail by `thumbnailId`, and the orphan sweep keeps both.
- CLI `backup <dir>`, `restore <dir>`, `migrate`: the portable Server Backup (ADR 0006), whatever the backends; no scheduler, the guide shows the cron line.

### Sync rules (`src/modules/sync/`)
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
The layout and its rules are in [`docs/architecture/structure.md`](./docs/architecture/structure.md) (ADR 0007).
Plugins: `fastify-type-provider-zod`, `@fastify/swagger`, `@fastify/swagger-ui`, `@fastify/cookie`, `@fastify/static`, `@fastify/rate-limit`, `@fastify/sensible`.
SSE is ~20 lines on `reply.raw`.
Logging is Fastify's pino; `pino-pretty` in dev only; `X-Request-Id` echoed.

### Testing
No mocked database: real databases with migrations applied, per test file.

| Tier | Against | Share |
|---|---|---|
| API over `app.inject()` | `buildServer()` on each Store (SQLite in memory, PGlite), memory `BlobStore`; every response parsed with the contract schema | most |
| Unit | `modules/sync/decide.ts`, the pairing and housekeeping services, `http/hal.ts`, `shared/passwords.ts`, `config.ts` | second |
| `Store` contract | SQLite in memory and PGlite; migrations from empty | one file |
| Concurrency | a real PostgreSQL in CI: two pushes at once never share a Sequence | small |
| `BlobStore` contract | disk (temp dir), memory, and S3 against SeaweedFS in CI | one file |
| Server Backup | round trips SQLite to PostgreSQL and back, disk to S3 and back | small |
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
  A cursor past the Account's Sequence also answers 410: it was issued before a restore rewound the database.
  Done when frontend slice 4 runs against it and a conflict yields a Conflicted Copy on the Device.
- [x] **B4 Blobs**: the blob routes, temp-file write, orphan sweep, size caps.
  Deviations: no byte counting past Content-Length, because Node's HTTP parser already ends the body there; blob responses also send `Content-Security-Policy: default-src 'none'; sandbox`, so uploaded HTML never runs as this origin.
  Done when frontend slice 5 syncs previews and bytes.
- [x] **B5 Setup and docs**: `docs/setup.md` (three modes, adding a phone, adding a household member, backup and restore, upgrade, Owner reset, the "your data" section, the exposure table per mode), release tagging.
  Done when a non-programmer follows the guide unsupervised in a user test.
  Deviation: the Caddyfile gained `default_sni`, because a browser opening an IP address sends no server name and the internal-CA mode failed the TLS handshake without it.
  The user test is still to run.
- [x] **B6 Share Links** (after sync works): `shares` table, mint, revoke and list routes, the unauthenticated `GET /api/public/shares/:token` and its blob route, the frontend `/share/$token` read-only route rendered through DOMPurify.
  Only reaches strangers in the own-domain mode; documented as such.
  Server side done; the `/share/$token` page is the frontend's. Tokens are stored in clear (ADR 0005), one share per Note.

## Rework: Stores, modules, backends (ADR 0006, 0007)

Every slice keeps `docs/openapi.json` byte for byte: the API does not change.
Each slice updates `docs/architecture/structure.md` and `CLAUDE.md` for what it moved, and trims the comments of every file it touches to the rule in `CLAUDE.md`.

- [x] **R1 Groundwork**, no behaviour change: `shared/` (secrets and hashing, clock, the server's errors mapped once to problem details), the ETag helper, `LiveUpdates` out of its route file, duplicates removed (`accountColumns`, `DAY_MS`, the `If-None-Match` check).
  Done when the suite passes untouched and no handler builds a 404, 403 or 409 itself.
  `BlobSizeMismatchError` is a `BadRequest`, so the upload route no longer maps it; `sendProblem` stays only where an answer must close or drain the connection, and in the hooks.
- [x] **R2 Modules and services**: the tree above, services as classes built in `server.ts` and reached through `app.decorate`, presenters, no route importing another route.
  Services still use Drizzle directly.
  Done when every route file is HTTP only.
  `createOwner` lives in the accounts service, so pairing sits below accounts and accounts below sessions with no cycle; API tests reach rules through `app.services` and live in `src/test/`.
- [x] **R3 The Store**: the async `Store` interface, the SQLite Store with its lock and `transaction(fn)` (a nested outer call throws), `/health` through `store.ping()`, the contract suite, Biome keeping drivers inside `src/infra/`.
  Done when no service imports Drizzle.
  A feed page is read in one transaction too, so a push cannot split it; without the lock the contract's isolation test fails, as the spike predicted.
- [x] **R4 PostgreSQL**: its schema and migrations (existing migrations move to `drizzle/sqlite/`, checked against an install made before the move), `DATABASE_URL`, the Account row lock on push, the advisory lock for one instance, waiting for the database at startup, secrets redacted from logs, the API suite on PGlite, a real PostgreSQL in CI, a Compose profile, its section of `docs/setup-backends.md`, and `docs/architecture/` "Adding a Store".
  Done when the whole suite passes on both Stores and the concurrency test passes on PostgreSQL.
  `accounts.lock(id, 'write' | 'read')` is `FOR NO KEY UPDATE` or `FOR SHARE` on the Account row: pushes to one Account serialize, a feed page never shows a row above its Sequence, and pages do not block each other; each lock was proven by removing it.
  Unique-key violations become the server's errors in the Postgres Store; a `tx` used after its transaction ends throws on both Stores.
  The API and contract suites run on SQLite and PGlite in plain `pnpm test`; the real-PostgreSQL suites need `PG_TEST_URL`.
- [x] **R5 S3**: `s3BlobStore` (bucket private, bytes always streamed through the server), `BLOB_STORE` and its settings, an S3-compatible server in CI and in a Compose profile, its section of `docs/setup-backends.md`.
  Done when the `BlobStore` contract passes on S3.
  Built in parallel with R3 and merged after it; `BlobStore.ts` moved to `src/store/`, the stores to `src/infra/blobs/`.
  MinIO left Docker Hub on 2026-09-11, so CI and Compose use SeaweedFS 4.48; versitygw 1.8 failed the contract by keeping a cut-off upload.
  `put` holds back the last chunk until the size checks out and aborts the request on failure, since S3 stores an object once it has all its bytes.
  Until R6, `backup` with S3 copies the database only and warns; the `younotes-local` profile now inherits the shared environment.
- [x] **R6 Server Backup and migrate**: `backup`, `restore`, `migrate` over the portable format, Sequences and Sessions copied exactly, `VACUUM INTO` removed, the setup guide's backup and restore section rewritten.
  Done when a SQLite and disk install moves to PostgreSQL and S3 and every Device keeps syncing without a resync.
  The format is a directory: `manifest.json` (written last, so a folder without one is incomplete), one JSON Lines file per kind, `blobs/<id>`; every line is checked with a strict schema before a restore writes anything.
  `migrate` streams Store to Store and BlobStore to BlobStore with no temp copy; the target is the server's own environment with each `TARGET_X` replacing `X`, so records and bytes can move separately.
  `restore` and `migrate` take the PostgreSQL instance lock and refuse while a server runs; `backup` works on a running server.
