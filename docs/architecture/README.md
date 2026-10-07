# Architecture

How the server is built, one short page per topic.
Decisions and their reasons are in [`../adr/`](../adr/); the plan is in [`../../PLAN.md`](../../PLAN.md).

1. [Structure](structure.md): the source tree and the rules that keep it simple.
2. [Adding a Store](adding-a-store.md): a new database or blob storage, from interface to wiring.
3. [Sync](sync.md): the push rules, Tombstones, the change feed and Live Updates.
4. [Transactions and locks](transactions.md): what `transaction(fn)` and `accounts.lock` promise, and how SQLite and PostgreSQL keep it.
5. [Blobs](blobs.md): an Attachment's bytes from upload to sweep.
