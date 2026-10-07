# Transactions and locks

What `transaction(fn)` and `accounts.lock` promise, and how each database keeps the promise.
The interface is `src/store/Store.ts`; the rules are enforced by `src/infra/guarded.ts`; the mechanics sit in `src/infra/sqlite/` and `src/infra/postgres/`.
The spike that found these rules is ADR 0006.

## The rules, on every database

- Every Store call is async, and `transaction(fn)` runs `fn` against a `tx` bound to one transaction: commit when `fn` resolves, roll back and rethrow when it rejects.
- Inside `fn` only its `tx` is used.
  The outer Store throws there (`guarded.ts`), because under SQLite it would wait on the lock its own transaction holds, and under PostgreSQL it would run outside the transaction.
  A `tx` kept after `fn` ended throws too.
  A service method that joins another's transaction takes the `tx` as a parameter.
- Reads inside a transaction see what others committed (READ COMMITTED), so work that must not interleave with another request takes `accounts.lock(id, mode)` before its first read; a read made earlier misses what the previous holder commits.
  `write` keeps out every other holder, `read` only writers.
- No byte or network I/O inside a transaction: under SQLite the lock is held for every other request meanwhile.
  Live Update hints go out after the commit.
- No error leaves a Store quoting its query's values; `guarded.ts` strips Drizzle's parameter dump and keeps only the database's message.

Who takes what:

| Work | Lock |
|---|---|
| a push | `write` |
| a feed page | `read` |
| minting a Share Link | `write` |
| creating an Account from a code, the sweep's records | a transaction, no lock |

## SQLite

better-sqlite3 is synchronous on one connection, and Drizzle refuses an async transaction on it.
So the SQLite Store runs every call, a whole `transaction(fn)` included, through one async lock (`lock.ts`); the Store's own `accounts.lock` is a no-op because the one lock already holds every Account.
The cost measured in the spike was about 3.5% on trivial reads.

- `transaction(fn)` opens with `BEGIN IMMEDIATE`, so a database busy in another process (the CLI) waits at `BEGIN` for up to `busy_timeout` (5 s) instead of failing mid-transaction.
- `serverBackup.read` opens a deferred `BEGIN`: it takes no write lock, and under WAL other connections' writers go on while its snapshot sees none of their commits.
  `serverBackup.write` is `BEGIN IMMEDIATE` again.
- The file runs with WAL, foreign keys on and `busy_timeout`; see `client.ts`.
- The instance lock is an exclusive transaction held open on `younotes.lock` beside the database (`instanceLock.ts`), so a second server on the same `DATA_DIR` is refused at startup, and `restore` and `migrate` take it too, so they refuse while a server runs.
  The kernel drops it with its process, so a crashed server never blocks the next start.
  A pid in a file could not do that: a container's server is pid 1 on every start, and the CLI runs in a container of its own.

## PostgreSQL

Transactions are isolated by the database, so there is no lock around calls; the pool runs them side by side.

- `accounts.lock(id, 'write')` is `SELECT ... FOR NO KEY UPDATE` on the Account row, `'read'` is `FOR SHARE`.
  `NO KEY UPDATE` rather than `UPDATE` because a row that references the Account (a sign-in, an upload) takes `KEY SHARE` for its foreign key and need not wait for a push.
- `serverBackup.read` runs `REPEATABLE READ`, `READ ONLY`: one snapshot the server's writes neither change nor wait for.
- Two advisory locks, keyed `"YouN"` plus a number: the instance lock, taken with `pg_try_advisory_lock` on a connection the server keeps open for its life, so a second server is refused at startup, and `restore` and `migrate` take it too, so they refuse while a server runs; and the migrations lock around `migrate`.
- PGlite, which the API tests run on, executes one transaction at a time, so it cannot show a race between two pushes.
  `src/test/concurrency.test.ts` runs those only against a real PostgreSQL (`PG_TEST_URL`).

Lock conflicts between two transactions on one Account:

| holds \ wants | `write` | `read` | an insert referencing the Account |
|---|---|---|---|
| `write` | waits | waits | proceeds |
| `read` | waits | proceeds | proceeds |
