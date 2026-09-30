# CLAUDE.md

The Self-hosted Server for the YouNotes PWA (`../ni-dip-fe`).
Fastify + SQLite (Drizzle) in one container behind Caddy; it serves the built PWA and syncs Notes between a person's Devices.

## Hard rules

- **Never push.** Ask before every commit and wait for the answer; the work is reviewed at each larger step to make sure it is on track.
- Update `CONTEXT.md`, `PLAN.md`, the ADRs and this file as decisions land, and keep them short: a context file that has grown stale or long is worse than none.
- Implementation runs on Opus 5.5 subagents; Fable oversees, reviews and decides.
- No `Co-Authored-By` trailers.
- Plain dash, never an em dash.
  In long Markdown, one sentence per line.
- Comments are short, plain and high level.
  Clean names and small functions say what the code does; a comment adds only what the code cannot: why, a decision (link the ADR), or a trap.
  Never narrate the next line, and write no comment where the code is already clear.

## Documentation map

- [`CONTEXT.md`](./CONTEXT.md): server-only terms; product terms are canonical in [`../ni-dip-fe/CONTEXT.md`](../ni-dip-fe/CONTEXT.md).
- [`PLAN.md`](./PLAN.md): everything decided, and the slices B1 to B6.
- [`docs/adr/`](./docs/adr/): decisions made in this repo; frontend ADRs 0017, 0018, 0020 are taken as given.
- `docs/openapi.json` is generated; never edit it by hand.
  The running server shows it at `/api/docs`.

## Commands

```bash
pnpm dev            # tsx watch src/main.ts, DATA_DIR=./data
pnpm build          # tsc
pnpm check          # biome check --write
pnpm check:ci       # biome ci .
pnpm test           # vitest run
pnpm openapi        # regenerate docs/openapi.json
pnpm db:generate    # drizzle-kit generate (migrations are applied at startup)
node dist/cli.js backup <dir>            # after pnpm build
node dist/cli.js reset-owner-password    # prints a new Owner password once
```

pnpm only; no npm, no yarn.

## Structure and rules of the code

See `PLAN.md` "Structure".
The rules that matter most:

- `buildServer()` never calls `listen()`; tests use `app.inject()` against real databases (SQLite in memory, PGlite).
  Never mock the database.
- Records go through the `Store` interface and bytes through `BlobStore` (ADR 0006).
  Routes call services, services call the two interfaces, and only `src/infra/` imports a driver or SDK (ADR 0007).
- No byte or network I/O inside `transaction(fn)`, and never the outer Store inside it.
- The sync rules (`decide.ts`) are pure: no HTTP, no Store.
- `src/contract/index.ts` imports nothing from the server and keeps its path; the frontend pulls it from there.
- Until the rework slices R1 to R6 in `PLAN.md` land, parts of the tree still follow the old layout.
- Validate at the boundary with the contract's Zod schemas; the auth hook is the only code that reads the cookie.
- Security measures listed in `PLAN.md` are requirements, not polish.
- Files under 500 lines.
