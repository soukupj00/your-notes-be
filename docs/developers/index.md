# For developers

The server is a Fastify app in TypeScript that keeps a household's Notes in step across their Devices and serves the built app from the same origin.
It runs as one Node 24 process in a container, with Caddy in front for TLS ([ADR 0004](../adr/0004-the-backend-image-takes-the-pwa-from-the-frontend-image.md)).
The app lives in [its own repository](https://github.com/soukupj00/your-notes-fe), with [its own developer pages](https://soukupj00.github.io/your-notes-fe/developers/).

## How it is made

Each feature is a module under `src/modules/<feature>/`: `routes.ts` speaks HTTP only, `service.ts` holds the rules, and `presenter.ts` turns records into HAL bodies ([ADR 0007](../adr/0007-a-feature-is-a-module-of-routes-a-service-and-presenters.md)).
`server.ts` builds every service once and hands them to the routes, and `buildServer()` never listens, so the tests drive the real app over `app.inject()`.

Services reach records only through the async `Store` interface and bytes only through `BlobStore` ([ADR 0006](../adr/0006-records-and-bytes-sit-behind-two-async-interfaces.md)).
SQLite and files on disk are the defaults, PostgreSQL and an S3 bucket the second implementations, and only `src/infra/` imports a driver or SDK, which Biome enforces.
The sync rules in `src/modules/sync/decide.ts` are pure functions, and `src/contract/index.ts` holds the Zod schemas the app pulls into its own repository.

## Develop

Needs Node 24 and pnpm through corepack (`corepack enable`).

```bash
pnpm install
pnpm dev          # http://localhost:3000, data in ./data
pnpm test
pnpm check        # Biome: lint and format
pnpm typecheck    # the tests too; the build leaves them out
pnpm openapi      # regenerate docs/openapi.json after an API change
pnpm db:generate  # a migration for both databases after a schema change
pnpm docs:dev     # this site
```

CI fails when `docs/openapi.json` or a migration is stale.
Two variables add a real PostgreSQL and S3 to the tests, and without them those tests are skipped; [Testing](../architecture/testing.md) has the details.

`pnpm dev` serves the API only until a built PWA is in `./public`, for example `cp -r ../ni-dip-fe/dist public`, where `../ni-dip-fe` is the frontend repository checked out next to this one.
The API reference is at `/api/docs`; the same document is on [The API](api.md) page and committed as `docs/openapi.json` for import into any HTTP client.

### The image without Caddy

`docker compose --profile local build` builds the image from this checkout through `compose.override.yml`, which only developers have; set `FE_IMAGE` in `.env` if the frontend image cannot be pulled.
To try the server alone on `http://localhost:3000` without Caddy:

```bash
docker compose --profile local up younotes-local
```

`--profile` replaces `COMPOSE_PROFILES`, so if `.env` sets it, name those profiles too, for example `docker compose --profile local --profile postgres up younotes-local`; otherwise the server waits for a database that never starts.
Stop it with the same flags: `docker compose --profile local down`, or `docker compose --profile local --profile postgres down`.
A plain `docker compose down` leaves it behind without its network, and its next start fails.
Running it for real, with Caddy, is [the setup guide](../setup.md).

### Try it on your phone

Phones only run the app over `https`, so `http://localhost:3000` is not enough.
With Tailscale on this machine and the phone (HTTPS Certificates on, see [Tailscale in the setup guide](../setup.md#3a-tailscale-recommended)), `tailscale serve` gives the dev server a real certificate without Docker:

```bash
# 1. Build the app and let the server serve it; repeat after every frontend change
(cd ../ni-dip-fe && pnpm build) && rm -rf public && cp -r ../ni-dip-fe/dist public

# 2. Start the server with the machine's tailnet name, so the Pairing Link points there
PUBLIC_URL=https://<machine>.<tailnet>.ts.net TRUST_PROXY=true pnpm dev

# 3. In a second terminal, once: https on the tailnet name, forwarded to port 3000
sudo tailscale serve --bg 3000
```

The machine's full name is on the Machines page of the Tailscale admin console, or in `tailscale serve status`.
The first time, `tailscale serve` prints a link to enable Serve on the tailnet; open it and run the command again.
Leave Funnel off: it would put the dev server on the public internet.

Open the Pairing Link from the log on the first Device to create the Owner; it works once.
Add every other Device from a signed-in one, under Settings, Devices, "Add a Device".
`./data` keeps the accounts across restarts; delete it to start over.
`sudo tailscale serve --https=443 off` stops serving.

## Release

1. Bump `version` in `package.json` and merge to `main`.
2. Tag that commit `v0.x.y` and push the tag; CI builds, smoke-tests and publishes the image under that tag.
3. Set `YOUNOTES_VERSION` in `.env.example` to the new tag, so new installs start on it; [the setup guide](../setup.md#4-start-it) downloads the files from the tag too, so update its three `curl` lines.

Every push to `main` also publishes this site to GitHub Pages.

## Read on

- [The API](api.md): HAL, problem details, the session cookie, the sync routes, and the full reference.
- [Architecture](../architecture/), one short page per topic: [Structure](../architecture/structure.md), [Adding a Store](../architecture/adding-a-store.md), [Sync](../architecture/sync.md), [Transactions and locks](../architecture/transactions.md), [Blobs](../architecture/blobs.md), [HTTP](../architecture/http.md) and [Testing](../architecture/testing.md).
- [Decisions](../adr/): what was decided in this repository, and why.
