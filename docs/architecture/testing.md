# Testing

How the tests run on real databases and storage, and which variables add the servers CI has.
`vitest.config.ts` defines the two projects; `src/test/helpers.ts` builds the app the API tests talk to; `src/test/storeContract.ts` runs the Store contract on every Store.
The test databases and the S3 test bucket are in `src/infra/postgres/testing.ts` and `src/infra/blobs/testing.ts`, left out of the build.

| Tests | Store | Blob Store | Runs when |
|---|---|---|---|
| unit tests, next to their code | none, or SQLite | none | always, project `sqlite` |
| API and service tests | SQLite in memory, and PGlite | memory | always, projects `sqlite` and `pglite` |
| Store contracts: `store`, `sync`, `serverBackup` | SQLite, PGlite, PostgreSQL | none | PostgreSQL with `PG_TEST_URL` |
| BlobStore contract | none | memory, disk, S3 | S3 with `S3_TEST_ENDPOINT` |
| `serverBackup.test.ts` | across SQLite and PGlite | disk, memory, S3 | S3 with `S3_TEST_ENDPOINT` |
| `concurrency.test.ts` | PostgreSQL | memory | only with `PG_TEST_URL` |
| `cli.test.ts` | SQLite files, PostgreSQL | disk | PostgreSQL with `PG_TEST_URL` |

## Two projects, one PGlite per file

- Project `sqlite` runs every test file; project `pglite` runs the API and service tests again with `TEST_STORE=pglite`, which `testStore()` reads.
  The contract suites loop over every Store themselves, so they run in `sqlite` only.
- Under `pglite`, `testStore()` returns the file's one PGlite, migrated once and emptied by every call; its `close` leaves the database open for the next test.
  The trap: a second `testStore()` in one test empties the first, so a test that needs two Stores takes the other database, as `otherStore()` in `serverBackup.test.ts` does.
- `pglite.setup.ts` boots that PGlite before the file's first test, so no test's timeout pays for the boot; `eachStore()` and `serverBackup.test.ts` boot theirs the same way.

## Real servers

- `PG_TEST_URL` names a PostgreSQL server the tests may create databases on; they create their own under random names and drop them when done.
  It adds PostgreSQL to the Store and Server Backup contracts and the CLI tests, and runs `concurrency.test.ts`.
- `S3_TEST_ENDPOINT` adds S3 to the BlobStore contract and `serverBackup.test.ts`, with `S3_TEST_ACCESS_KEY_ID`, `S3_TEST_SECRET_ACCESS_KEY` and `S3_TEST_BUCKET` (default `yournotes-test`, created when missing).
  Each S3 Blob Store gets a random key prefix, and the file deletes what it wrote, so tests and runs never collide.
- CI starts PostgreSQL and SeaweedFS as services of the test job and points the variables at them; without them `pnpm test` skips those tests and runs the rest.
- PGlite runs one transaction at a time, so races between requests show only on a real PostgreSQL.
  `concurrency.test.ts` drives the services directly; where a push must wait behind a feed page, it polls until PostgreSQL reports it blocked on a lock (`lockWaiters`), never for a fixed time.

## Contracts across Stores

- `eachStore()` declares each check once per Store; every check starts with Accounts `a`, the Owner, and `b`.
  A new Store joins by being added there, as [`adding-a-store.md`](adding-a-store.md) describes.
- The `serverBackup` contract copies every record from each Store into every other, and checks on a SQLite file and on PostgreSQL that `read` keeps one snapshot while a second connection commits.
- `serverBackup.test.ts` crosses through the API: each project's `testStore()` is the source and `otherStore()` the target, so both directions run.

## Helpers

- `testServer()` builds the real app for `app.inject()` over a fresh Store and a memory Blob Store, or the ones passed in; a Store passed in stays open when the app closes.
- `src/test/helpers.ts` also holds the API's builders (`note`, `tag`, `link`, `batch`), `push` and `pull`, the sign-up steps, `expectProblem`, and `must`, which fails naming the value that is missing.
- `src/test/storeContract.ts` has builders of its own, shaped as stored records with a `rev`, where the API's are shaped as a Device sends them.
- Never mock the database: set up and inspect state through the Store.
