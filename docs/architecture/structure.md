# Structure

```
src/
  contract/index.ts   the shared Zod contract; the frontend vendors this file
  config.ts           environment variables to a validated Config
  server.ts           buildServer(): builds every service once over the Store and BlobStore it is given, registers the routes, never listens
  main.ts             makes the logger, opens the Store and BlobStore the config names, sweeps daily, listens, prints the first-run Pairing Link, closes the Store on shutdown
  cli.ts              backup <dir>, restore <dir>, migrate (to the TARGET_ variables), reset-owner-password
  version.ts          the server's version, read from package.json
  modules/<feature>/  routes.ts (HTTP only), service.ts (the rules), presenter.ts (records to HAL bodies)
    accounts          Local Accounts: creating the Owner and members, listing, password reset
    sessions          sign-in, Sessions and the Devices behind them
    pairing           Pairing Codes and the first run
    sync              push and feed; decide.ts (the sync rules, pure), liveUpdates.ts (the open SSE streams)
    blobs             Attachment bytes
    shares            Share Links
    housekeeping      the daily sweep (old Tombstones raising the pruned Sequence, Sessions, Pairing Codes, orphan blobs) and the /health ping
    backup            the Server Backup, no routes: service.ts (backup, restore, migrate), format.ts (the directory: manifest, JSON Lines, blobs)
    meta              the HAL root and /health, routes only
  store/              Store.ts (the records interface), records.ts (what it takes and returns), BlobStore.ts (the bytes interface), one contract suite each (the Store's is store.contract.test.ts plus sync.contract.test.ts), and one for serverBackup
  infra/              open.ts (picks the Store and BlobStore from the config, and says where each keeps its data), guarded.ts (the transaction rules: no outer Store inside, no tx after; no error quoting query values), rows.ts (rows to records and the Server Backup's paging, both databases), waitFor.ts (waiting at startup for PostgreSQL or S3)
  infra/sqlite/       schema.ts, client.ts, migrate.ts, store.ts (the Store), lock.ts (its one async lock), serverBackup.ts (its serverBackup group)
  infra/postgres/     schema.ts, client.ts (waiting for the database, the advisory locks, the pool), migrate.ts, store.ts (the Store), serverBackup.ts; loaded only with DATABASE_URL
                      testing.ts (PGlite and throwaway databases for tests; not built)
  infra/blobs/        disk.ts, memory.ts, s3.ts (loaded only when BLOB_STORE=s3), testing.ts (the S3 test bucket; not built)
  http/               what routes share: auth and security hooks, errors, docs, static (PWA), hal, etag, session cookie, sendBlob
  shared/             crypto (secrets and their SHA-256), passwords (scrypt), clock, errors (the server's, no HTTP), warn (the warning callback's type)
  test/               helpers.ts (the test Store, the test server, the sign-up steps), storeContract.ts (the Store contract's records and the Stores it runs on), pglite.setup.ts (boots a file's PGlite before its first test), the API tests, serverBackup.test.ts (across Stores and BlobStores), concurrency.test.ts (real PostgreSQL only)
drizzle/sqlite/, drizzle/postgres/   generated migrations, applied when the Store opens
scripts/openapi.ts    writes docs/openapi.json
```

## Rules

- A route file is HTTP only: schemas, auth, status codes, cookies and headers.
- A service is a class that takes what it needs in its constructor and knows nothing of Fastify (ADR 0007).
- `server.ts` builds every service once and hands them to the routes as `app.services`.
- Services throw the errors in `shared/errors.ts`, and `http/errors.ts` turns them into problem details.
  `sendProblem` is left to the hooks, the not-found handler and the blob routes, whose early answers must close or drain the connection.
- No route file imports another; what two features share lives in `http/`, `shared/` or a presenter.
- Services reach records only through the async `Store` (ADR 0006), shaped by the domain, and its records carry no SQL nulls and no Drizzle types.
- Only `src/infra/` imports `drizzle-orm`, `better-sqlite3`, `pg`, `@electric-sql/pglite` or `@aws-sdk/*` (the contract suites may, to set up real backends), and nothing under `src/modules/`, `src/http/`, `src/store/` or `src/shared/` imports `src/infra/`; Biome's `noRestrictedImports` fails the build otherwise.
- `infra/open.ts` loads PostgreSQL and S3 with a dynamic `import()`, so a SQLite and disk install never loads their drivers.
- Reads and writes that must not interleave with another request run in one `transaction(fn)`: the push, a feed page, minting a Share Link, an account created by a code, the sweep's records.
  PostgreSQL reads what others committed before each statement, so the push and Share Link minting first take `accounts.lock(id, 'write')` and a feed page `accounts.lock(id, 'read')`.
- Inside `transaction(fn)` only the `tx` it passes is used; a service method that joins another's transaction takes it as a parameter (`spend(code, kind, store = this.#store)`).
  No byte or network I/O happens inside, and Live Update hints are sent after the commit.
- The SQLite Store runs every call through one async lock, a wrapper in `lock.ts` rather than code in each method.
  Both Stores are wrapped by `guarded.ts`, so calling the outer Store inside `fn` throws instead of waiting on a lock its own transaction holds, and a `tx` kept after `fn` throws instead of running outside the transaction.
- With PostgreSQL the server holds an advisory lock for its lifetime, so a second instance stops at startup (ADR 0006); `restore` and `migrate` take it too, so they refuse while a server runs.
- The Server Backup reads every record in one snapshot through `serverBackup.read` (SQLite: a deferred read transaction, which WAL lets the server's writers pass; PostgreSQL: REPEATABLE READ), and copies bytes only after it ends.
  `restore` and `migrate` write bytes first, then every record in one `serverBackup.write`, and only into an empty Store and BlobStore; on failure they delete the bytes they wrote, so a retry finds the target empty.
- `buildServer()` takes its config, Store and BlobStore as arguments and never calls `listen()`.
- Tests run the real app over `app.inject()` against a real Store with the migrations applied; the database is never mocked, and tests set up or inspect state through the Store.
  Vitest runs the API and service tests twice, as project `sqlite` (in memory) and project `pglite` (one PGlite per test file, booted before its first test and emptied for each).
- A unit test sits next to what it tests; the API tests and the service unit tests share `test/helpers.ts`.
- The Store contract (`store.contract.test.ts`, and `sync.contract.test.ts` for the sync group) runs every check on every Store through `eachStore()` in `test/storeContract.ts`, the transaction rules included: SQLite, PGlite, and a real PostgreSQL when `PG_TEST_URL` is set.
- `src/contract/index.ts` imports only `zod`, because it runs in the browser too.
- Requests are validated at the boundary with the contract's schemas, and every error leaves as RFC 9457 problem details.
- `docs/openapi.json` and `drizzle/` are generated; CI fails when either is stale.
- Files stay under 500 lines.
