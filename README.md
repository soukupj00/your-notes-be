# YouNotes Self-hosted Server

The sync server for the [YouNotes](../ni-dip-fe) PWA.
It keeps a household's Notes in step across their Devices and serves the app itself from the same origin.
Fastify and SQLite in one container, with Caddy in front for TLS.

## Develop

Needs Node 24 and pnpm through corepack (`corepack enable`).

```bash
pnpm install
pnpm dev          # http://localhost:3000, data in ./data
pnpm test
pnpm check        # Biome: lint and format
```

`pnpm dev` serves the API only until a built PWA is in `./public`, for example `cp -r ../ni-dip-fe/dist public`.
The API reference is at `/api/docs`; the same document is committed as [`docs/openapi.json`](./docs/openapi.json) for import into any HTTP client.

## Self-host

```bash
cp .env.example .env    # set YOUNOTES_HOST and YOUNOTES_TLS
docker compose up -d
```

To try the server alone on `http://localhost:3000` without Caddy:

```bash
docker compose --profile local up younotes-local
```

A full setup guide is still to come; until then [`PLAN.md`](./PLAN.md) describes the deployment modes.

## More

- [`PLAN.md`](./PLAN.md): what is decided and what is being built.
- [`docs/architecture/`](./docs/architecture/README.md): how the code is laid out.
- [`docs/adr/`](./docs/adr/): the decisions and why.
