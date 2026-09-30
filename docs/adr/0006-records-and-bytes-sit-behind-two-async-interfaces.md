# Records and bytes sit behind two async interfaces, so a deployment picks its database and its blob storage

Until now Drizzle over better-sqlite3 was the only database seam, and `PLAN.md` said an interface exists only where a second implementation does.
Decided 2026-09-30: the server ships two backends for records, SQLite (the default, unchanged for existing installs) and PostgreSQL, and two for bytes, disk (the default) and S3-compatible object storage.
The second implementations now exist, so the interfaces have earned their place.

**Store** is the interface for records.
It is shaped by the domain (`accounts`, `sessions`, `codes`, `sync`, `blobRecords`, `shares`, `housekeeping`), not by tables, and every method is async.
`transaction(fn)` runs `fn` against a transaction-bound Store and commits when it resolves.
The frontend's ADR 0020 keeps `transaction` off its Local Store because IndexedDB and a Remote cannot both promise one; every server database can, and without it the push rules would be copied into each Store.
**BlobStore** keeps its shape and gains an S3 implementation beside disk and memory.
`DATABASE_URL` selects PostgreSQL, and `BLOB_STORE=s3` with an endpoint, bucket and keys selects S3; nothing set means SQLite and disk in `DATA_DIR`, as today.
Each implementation passes one shared contract suite per interface, and the whole API suite runs against both Stores.

Rules found by a spike on 2026-09-30, which every implementation keeps:

- better-sqlite3 cannot run an async transaction (Drizzle throws "Transaction function cannot return a promise"), and a manual `BEGIN` on its one connection let a concurrent request read the unfinished push and lose its own write on rollback.
  The SQLite Store therefore runs every call through one async lock, a wrapper around the Store rather than code in each method; it cost about 3.5% on trivial reads.
- Calling the outer Store inside `transaction(fn)` would wait on its own lock under SQLite, so it throws instead of hanging.
- No byte or network I/O inside a transaction: under SQLite it holds the lock for every request.
- PostgreSQL isolates transactions but not the Sequence, so a push locks its Account row (`FOR UPDATE`) and two pushes cannot hand out the same Sequence.
  This is tested against a real PostgreSQL, because PGlite runs one transaction at a time and cannot show the race.
- Timestamps stay ISO 8601 text in both databases, because the code compares them as strings.
- A Store turns its database's unique-key violations into the server's own errors.
- Engine-specific SQL (`json_each`, two-argument `max`) lives only in its Store.
  Drivers and SDKs are imported only under `src/infra/`, enforced by Biome, and loaded with a dynamic `import()`, so a SQLite and disk install never loads `pg` or the AWS SDK.

Each database keeps its own Drizzle schema and migrations (`drizzle/sqlite/`, `drizzle/postgres/`), so queries are written once per database.
That duplication is the price of typed per-database schemas; the contract suite keeps the two honest, and it is the worked example of adding a database.

The server runs as **one instance**.
Live Update hints, rate-limit counters, the daily sweep and the first-run setup code live in the process, and with PostgreSQL a second instance is refused at startup by an advisory lock.
Running several would need `LISTEN/NOTIFY` for the hints and a shared rate-limit store; the Live Update registry sits behind a small interface so that can be added later.

**A Server Backup and a move between backends are one format.**
`backup <dir>` writes every record, read in one transaction, then the bytes those records list, into a portable directory: one JSON Lines file per table, the blobs, and a manifest with a format version.
`restore <dir>` loads it into an empty Store and BlobStore, and `migrate` does both in one step, for example from SQLite on disk to PostgreSQL and S3.
The Sequence and pruned Sequence of every Account are copied exactly, so Device cursors stay valid, and Sessions are copied, so Devices stay signed in; Pairing Codes are not, being minutes-lived.
`pg_dump` and bucket versioning are documented as the native alternatives, and `VACUUM INTO` leaves.

Considered and rejected:

- Kysely, one query builder for both databases: it rewrites every query and hides the per-database example this change exists to show.
- An in-memory Store: SQLite in memory is already fast and is the real thing.
- A generic `Repository<T>`: the aggregates share little beyond the name.
- Keeping Drizzle as the only seam: its synchronous API and SQLite-only SQL reach every caller, so a second database would touch every file.
