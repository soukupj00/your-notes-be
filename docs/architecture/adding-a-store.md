# Adding a Store

Records sit behind the `Store` interface and bytes behind `BlobStore` (ADR 0006).
SQLite and PostgreSQL are the worked examples of the first, disk and S3 of the second.
Adding another backend touches three places and nothing in `src/modules/` or `src/http/`.

## 1. Implement the interface

Put the implementation in `src/infra/<name>/`, the only place allowed to import its driver; Biome's `noRestrictedImports` fails the build otherwise.
Add the driver's package to both lists in `biome.json`: the top-level one, and the one in the override for `src/modules/**`, `src/http/**`, `src/store/**` and `src/shared/**`, which replaces it there.
A Store implements `src/store/Store.ts` and returns the plain records of `src/store/records.ts`: no SQL nulls, no driver types.
For a SQL database that means its own Drizzle schema mirroring the other two, its own migrations under `drizzle/<name>/` with a drizzle-kit config of its own added to `pnpm db:generate`, and its own queries; `src/infra/rows.ts` already maps rows to records when the schema gives the same rows.

The rules every Store keeps, all documented in `Store.ts`:

- Every call is async, and `transaction(fn)` runs `fn` against a Store bound to one transaction.
- Calling the outer Store inside `fn` throws, and so does a `tx` kept after its transaction ended; wrap the Store in `guarded()` from `src/infra/guarded.ts` to get both for free.
  Each group is a plain object of functions that do not use `this`, because `guarded()` wraps a group's own properties and calls them unbound.
- `accounts.lock(id, mode)` holds the Account until the transaction ends, which is what keeps two pushes from sharing a Sequence and a feed page from reaching past its own.
  A database that runs one transaction at a time, like SQLite behind its lock, implements it as nothing.
- Timestamps are ISO 8601 text, compared as strings.
- A unique-key violation never escapes as a driver error: a taken username throws `UsernameTaken`, a blob recorded twice is a no-op, and minting a Share Link holds the Account so a second mint finds the first.
- No error leaves the Store quoting its query's values, which hold Note bodies and password and token hashes.
  Drizzle's `DrizzleQueryError` quotes every parameter, so `guarded()` replaces it with the database's own message, kept as is because validation at the boundary keeps out the malformed values a database would quote ("invalid input syntax"); a driver that quotes values elsewhere needs the same.
- Engine-specific SQL stays in the Store.
- The server runs as one instance (ADR 0006).
  A Store refuses a second server at startup, as PostgreSQL's advisory lock and SQLite's `younotes.lock` do (`holdInstanceLock` in `src/infra/postgres/client.ts` and `src/infra/sqlite/instanceLock.ts`), and `restore` and `migrate` take the same lock, so they refuse while a server runs (`StoreOptions.oneInstance` in `src/infra/open.ts`).
- The `serverBackup` group is part of the Store: it reads every table whole, as stored, in one snapshot that does not block the server's writers, and writes a whole Server Backup into an empty Store in one transaction.
  The SQLite and PostgreSQL versions sit in their own `serverBackup.ts`; each maps the kinds of `BACKUP_KINDS` to its tables and reads a page in primary-key order, and `recordsOf` and `writeEach` in `src/infra/rows.ts` do the rest.

A BlobStore implements `src/store/BlobStore.ts` in `src/infra/blobs/<name>.ts`: write-once bytes by id, a size check before a write counts, and a listing for the sweep.

## 2. Pass the contract suite

Add the new backend to `eachStore()` in `src/test/storeContract.ts`, which every Store contract file runs on, and to the list of `serverBackup.contract.test.ts`, or of `blobStore.contract.test.ts` for a BlobStore.
The `serverBackup` contract copies every record into every other Store, and, for a database that runs transactions side by side, checks the snapshot from a second connection.
A backend that needs a server runs only when a `*_TEST_*` variable points at one, like `PG_TEST_URL` and `S3_TEST_ENDPOINT`; CI starts that server as a service of the test job.
Never weaken a contract test to make an implementation pass; when the new backend needs a new method, every implementation gets it and the contract tests it.

If the database runs transactions side by side, cover it in `src/test/concurrency.test.ts` as well: only a real server shows those races.
That file runs against PostgreSQL only and has no list of backends, so give it one, or a block of its own for the new database.
To run the whole API suite on the new Store, give `testStore()` in `src/test/helpers.ts` a branch for it and add a Vitest project in `vitest.config.ts`, as PGlite has.
`otherStore()` in `src/test/serverBackup.test.ts` is hard-wired to cross between SQLite and PGlite; give it a branch too, so the API-level backup tests cross into the new Store.

## 3. Wire it in

`src/infra/open.ts` chooses the Store and BlobStore from the config, for both `main.ts` and `cli.ts`.
Add a branch there that loads the new backend with a dynamic `import()`, so an install that does not choose it never loads its driver.
Its switches have no default case, so `tsc` names each one to extend: `openStore` or `openBlobStore`, and `storeLocation` or `blobStoreLocation`, which tell `migrate` whether a target is another place.
Add its settings to `src/config.ts` (validated, named but never echoed in errors, and added to `REDACT` if they carry a secret), `compose.yml`, `.env.example` and `docs/setup-backends.md`.
