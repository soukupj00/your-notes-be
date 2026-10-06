# YouNotes Self-hosted Server

The sync server for the [YouNotes](https://gitlab.fit.cvut.cz/soukuj26/ni-dip-fe) PWA.
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

`docker compose --profile local build` builds the image from this checkout through `compose.override.yml`, which only developers have; set `FE_IMAGE` in `.env` if the frontend image cannot be pulled.
`pnpm dev` serves the API only until a built PWA is in `./public`, for example `cp -r ../ni-dip-fe/dist public`.
The API reference is at `/api/docs`; the same document is committed as [`docs/openapi.json`](./docs/openapi.json) for import into any HTTP client.

### Try it on your phone

Phones only run the app over `https`, so `http://localhost:3000` is not enough.
With Tailscale on this machine and the phone (HTTPS Certificates on, see [`docs/setup.md`](./docs/setup.md) section 3a), `tailscale serve` gives the dev server a real certificate without Docker:

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

## Self-host

```bash
cp .env.example .env    # set YOUNOTES_HOST and YOUNOTES_TLS
docker compose up -d
```

To try the server alone on `http://localhost:3000` without Caddy:

```bash
docker compose --profile local up younotes-local
```

`--profile` replaces `COMPOSE_PROFILES`, so if `.env` sets it, name those profiles too, for example `docker compose --profile local --profile postgres up younotes-local`; otherwise the server waits for a database that never starts.
Stop it with the same flags: `docker compose --profile local down`, or `docker compose --profile local --profile postgres down`.
A plain `docker compose down` leaves it behind without its network, and its next start fails.

On first start the server log prints a Pairing Link and a QR code; open it on your phone to create the Owner.
To reset a forgotten Owner password, run `docker compose exec younotes node dist/cli.js reset-owner-password`.

The step-by-step guide for people running it at home, including the three TLS modes and backups, is [`docs/setup.md`](./docs/setup.md).
Keeping the records in PostgreSQL or the Attachments in an S3 bucket, and moving a running server there, is in [`docs/setup-backends.md`](./docs/setup-backends.md).

## Release

1. Bump `version` in `package.json` and merge to `main`.
2. Tag that commit `v0.x.y` and push the tag; CI builds, smoke-tests and publishes the image under that tag.
3. Set `YOUNOTES_VERSION` in `.env.example` to the new tag, so new installs start on it; `docs/setup.md` downloads the files from the tag too, so update its three `curl` lines.

## More

- [`PLAN.md`](./PLAN.md): what is decided and what is being built.
- [`docs/architecture/`](./docs/architecture/README.md): how the code is laid out.
- [`docs/adr/`](./docs/adr/): the decisions and why.

## License

[MIT](./LICENSE).

<img src="https://fit.cvut.cz/static/images/fit-cvut-logo-en.svg" alt="FIT CTU logo" height="200">

This software was developed with the support of the **Faculty of Information Technology, Czech Technical University in Prague**.
For more information, visit [fit.cvut.cz](https://fit.cvut.cz/en).
