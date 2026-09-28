# Structure

```
src/
  contract/index.ts   the shared Zod contract; the frontend vendors this file
  config.ts           environment variables to a validated Config
  server.ts           buildServer(): the whole app, never listens
  main.ts             opens the database, migrates, listens, prints the first-run Pairing Link
  cli.ts              backup <dir>, reset-owner-password
  problem.ts          every error as application/problem+json
  hal.ts              _links and _embedded helpers
  auth/               passwords (scrypt), sessions (cookie), codes (Pairing Codes)
  db/                 schema.ts, client.ts, migrate.ts
  blobs/              BlobStore interface, disk and memory stores, one contract test
  plugins/            auth, security (CSRF, headers, request id), docs, static (PWA)
  routes/             one file per route group
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
- `docs/openapi.json` and `drizzle/` are generated; CI fails when either is stale.
- Files stay under 500 lines.
