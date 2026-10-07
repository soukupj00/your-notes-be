# Architecture

How the server is built, one short page per topic.
Decisions and their reasons are in [`../adr/`](../adr/); the plan is in [`PLAN.md`](https://github.com/soukupj00/your-notes-be/blob/main/PLAN.md).

1. [Structure](structure.md): the source tree and the rules that keep it simple.
2. [Adding a Store](adding-a-store.md): a new database or blob storage, from interface to wiring.
3. [Sync](sync.md): the push rules, Tombstones, the change feed and Live Updates.
4. [Transactions and locks](transactions.md): what `transaction(fn)` and `accounts.lock` promise, and how SQLite and PostgreSQL keep it.
5. [Blobs](blobs.md): an Attachment's bytes from upload to sweep.
6. [HTTP](http.md): the order of the hooks, the answers that skip them, ETags and problem details.
7. [Testing](testing.md): the two Vitest projects, the contracts across Stores, and the variables that add a real PostgreSQL and S3.
