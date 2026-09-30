# Structure

```
src/
  contract/index.ts   the shared Zod contract; the frontend vendors this file
  config.ts           environment variables to a validated Config
  server.ts           buildServer(): the whole app, never listens
  main.ts             opens the database, migrates, sweeps daily, listens, prints the first-run Pairing Link
  cli.ts              backup <dir>, reset-owner-password
  problem.ts          every error as application/problem+json; the one place the server's errors get a status
  hal.ts              _links and _embedded helpers
  sweep.ts            expired Tombstones (raising pruned_seq), Sessions, Pairing Codes, orphan blobs, shares of purged Notes
  shared/             crypto.ts (secrets and their SHA-256), clock.ts (Clock, DAY_MS), errors.ts (the server's errors, no HTTP)
  http/               etag.ts: ETag of a body, the If-None-Match check
  sync/               decide.ts: the sync rules, pure, no HTTP and no Drizzle; liveUpdates.ts: the open SSE streams
  auth/               passwords (scrypt), sessions (cookie), codes (Pairing Codes)
  db/                 schema.ts, client.ts, migrate.ts, rows.ts (rows to and from the contract)
  blobs/              BlobStore interface, disk and memory stores, one contract test
  plugins/            auth, security (CSRF, headers, request id), docs, static (PWA)
  test/               helpers.ts: the test server and sign-up steps the API tests share
  routes/             one file per route group; changes.ts (push, feed), stream.ts (SSE), blobs.ts (bytes), shares.ts (Share Links)
drizzle/              generated migrations, applied at startup
scripts/openapi.ts    writes docs/openapi.json
```

## Rules

- `buildServer()` takes its config, database and blob store as arguments and never calls `listen()`.
- Tests run the real app over `app.inject()` against an in-memory SQLite with the migrations applied; the database is never mocked.
- `src/contract/index.ts` imports only `zod`, because it runs in the browser too.
- An interface exists only where there is a second implementation; today that is `BlobStore` alone.
- There is no repository layer: routes use Drizzle directly.
- Requests are validated at the boundary with the contract's schemas, and every error leaves as RFC 9457 problem details.
- Handlers throw the errors in `shared/errors.ts`, and `problem.ts` turns them into problem details (ADR 0007).
  `sendProblem` is left to the hooks, the not-found handler and the blob routes, whose early answers must close or drain the connection.
- `docs/openapi.json` and `drizzle/` are generated; CI fails when either is stale.
- Files stay under 500 lines.
