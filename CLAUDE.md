# CLAUDE.md

The Self-hosted Server for the YouNotes PWA, which lives in the frontend repository, `ni-dip-fe`.
Fastify + SQLite or PostgreSQL (Drizzle) in one container behind Caddy; it serves the built PWA and syncs Notes between a person's Devices.

## Hard rules

- **Never push.** Ask before every commit and wait for the answer; the work is reviewed at each larger step to make sure it is on track.
- Update `CONTEXT.md`, `PLAN.md`, the ADRs and this file as decisions land, and keep them short: a context file that has grown stale or long is worse than none.
- Implementation runs on Opus 5.5 subagents; Fable oversees, reviews and decides.
- No `Co-Authored-By` trailers.
- Plain dash, never an em dash.
  In long Markdown, one sentence per line.
- Comments are for the human developer reading the code, never for agents.
  Agents get their context from the `.md` files (this file, `CONTEXT.md`, the ADRs, `docs/`), so a comment never briefs an agent.
- Code explains itself first: clean names and small functions say what the code does.
  A comment adds only what the code cannot say: why, a decision (link the ADR), a trap, or a constraint from outside the code.
- A comment is one to three lines.
  An explanation that needs more belongs in `CONTEXT.md`, an ADR or the area's doc, with a one-line pointer in the code.
- Never narrate the next line, never explain styling or layout, and write no comment where the code is already clear.

## Documentation map

- [`CONTEXT.md`](./CONTEXT.md): server-only terms; product terms are canonical in the frontend repository's `CONTEXT.md`.
- [`PLAN.md`](./PLAN.md): everything decided, and the slices B1 to B6.
- [`docs/adr/`](./docs/adr/): decisions made in this repo; frontend ADRs 0017, 0018, 0020 are taken as given.
- `docs/openapi.json` is generated; never edit it by hand.
  The running server shows it at `/api/docs`.
- `docs/` is also the source of the VitePress site, published to GitHub Pages from `main` (`docs/.vitepress/config.ts`, `.github/workflows/pages.yml`); `docs/superpowers/` is left out of it.
  A page's links must resolve on the site and on GitHub alike, and the build fails on a dead one.

## Commands

```bash
pnpm dev            # tsx watch src/main.ts, DATA_DIR=./data
pnpm build          # empties dist/, then tsc
pnpm check          # biome check --write
pnpm check:ci       # biome ci .
pnpm typecheck      # tsc over src, scripts and the tests; the build excludes the tests
pnpm test           # vitest run
pnpm openapi        # regenerate docs/openapi.json
pnpm db:generate    # drizzle-kit generate, both databases (migrations are applied at startup)
pnpm docs:dev       # the docs site; pnpm docs:build is what Pages runs
node dist/cli.js backup <dir>            # after pnpm build; the portable Server Backup
node dist/cli.js restore <dir>           # into an empty Store and BlobStore
node dist/cli.js migrate                 # to where the TARGET_ variables say
node dist/cli.js reset-owner-password    # prints a new Owner password once
```

pnpm only; no npm, no yarn.

## Structure and rules of the code

See [`docs/architecture/structure.md`](./docs/architecture/structure.md).
The rules that matter most:

- `buildServer()` never calls `listen()`; tests use `app.inject()` against a real Store, never a mock, and set up and inspect state through the Store.
  How they run is in [`docs/architecture/testing.md`](./docs/architecture/testing.md); two variables add the real servers CI has, and without them those tests are skipped.
  `PG_TEST_URL` names a PostgreSQL server the tests may create databases on, such as `postgres://postgres:postgres@127.0.0.1:5432/postgres`.
  `S3_TEST_ENDPOINT` adds S3, such as SeaweedFS at `http://127.0.0.1:8333` as in CI, with `S3_TEST_ACCESS_KEY_ID`, `S3_TEST_SECRET_ACCESS_KEY` and `S3_TEST_BUCKET` (default `younotes-test`).
- Records go through the `Store` interface and bytes through `BlobStore` (ADR 0006).
  Routes call services, services call the two interfaces, and only `src/infra/` imports a driver or SDK (ADR 0007); Biome enforces it.
- Store calls are async, so reads and writes that must not interleave with another request share one `transaction(fn)`; one that decides on an Account's rows takes `accounts.lock` first, since PostgreSQL reads what others committed.
  Inside it no byte or network I/O, and only its `tx`: a service method that joins a transaction takes `tx` as a parameter.
  The full rules are in [`docs/architecture/transactions.md`](./docs/architecture/transactions.md); the life of an Attachment's bytes in [`docs/architecture/blobs.md`](./docs/architecture/blobs.md).
- The sync rules (`decide.ts`) are pure: no HTTP, no Store; they are specified in [`docs/architecture/sync.md`](./docs/architecture/sync.md).
- `src/contract/index.ts` imports nothing from the server and keeps its path; the frontend pulls it from there.
- Validate at the boundary with the contract's Zod schemas; the auth hook is the only code that reads the cookie.
- Security measures listed in `PLAN.md` are requirements, not polish.
- Files under 500 lines.
