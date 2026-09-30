# Structure

```
src/
  contract/index.ts   the shared Zod contract; the frontend vendors this file
  config.ts           environment variables to a validated Config
  server.ts           buildServer(): builds every service once, registers the routes, never listens
  main.ts             opens the database, migrates, sweeps daily, listens, prints the first-run Pairing Link
  cli.ts              backup <dir>, reset-owner-password
  modules/<feature>/  routes.ts (HTTP only), service.ts (the rules), presenter.ts (records to HAL bodies)
    accounts          Local Accounts: creating the Owner and members, listing, password reset
    sessions          sign-in, Sessions and the Devices behind them
    pairing           Pairing Codes and the first run
    sync              push and feed; decide.ts (the sync rules, pure), liveUpdates.ts (the open SSE streams)
    blobs             Attachment bytes
    shares            Share Links
    housekeeping      the daily sweep: old Tombstones (raising pruned_seq), Sessions, Pairing Codes, orphan blobs
    meta              the HAL root and /health
  http/               what routes share: auth and security hooks, errors, docs, static (PWA), hal, etag, session cookie, sendBlob
  shared/             crypto (secrets and their SHA-256), passwords (scrypt), clock, errors (the server's, no HTTP)
  db/                 schema.ts, client.ts, migrate.ts, rows.ts (rows to and from the contract)
  blobs/              BlobStore interface, disk and memory stores, one contract test
  test/               helpers.ts (the test server and sign-up steps) and the API tests
drizzle/              generated migrations, applied at startup
scripts/openapi.ts    writes docs/openapi.json
```

## Rules

- A route file is HTTP only: schemas, auth, status codes, cookies and headers.
- A service is a class that takes what it needs in its constructor and knows nothing of Fastify (ADR 0007).
- `server.ts` builds every service once and hands them to the routes as `app.services`.
- Services throw the errors in `shared/errors.ts`, and `http/errors.ts` turns them into problem details.
  `sendProblem` is left to the hooks, the not-found handler and the blob routes, whose early answers must close or drain the connection.
- No route file imports another; what two features share lives in `http/`, `shared/` or a presenter.
- Services still use Drizzle directly; the `Store` interface takes that over in R3 (ADR 0006).
- `buildServer()` takes its config, database and blob store as arguments and never calls `listen()`.
- Tests run the real app over `app.inject()` against an in-memory SQLite with the migrations applied; the database is never mocked.
- A unit test sits next to what it tests; the API tests share `test/helpers.ts`.
- `src/contract/index.ts` imports only `zod`, because it runs in the browser too.
- An interface exists only where there is a second implementation; today that is `BlobStore` alone.
- Requests are validated at the boundary with the contract's schemas, and every error leaves as RFC 9457 problem details.
- `docs/openapi.json` and `drizzle/` are generated; CI fails when either is stale.
- Files stay under 500 lines.
