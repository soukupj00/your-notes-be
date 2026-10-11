# YourNotes Self-hosted Server

The sync server for the [YourNotes](https://soukupj00.github.io/your-notes-fe/) PWA.
It keeps a household's Notes in step across their Devices and serves the app itself from the same origin.
Fastify and SQLite in one container, with Caddy in front for TLS.

Everything else is on the site, <https://soukupj00.github.io/your-notes-be/>: how it works, [setting it up at home](https://soukupj00.github.io/your-notes-be/setup.html), and [the pages for developers](https://soukupj00.github.io/your-notes-be/developers/).
The same pages are the Markdown files under [`docs/`](./docs/).

## Develop

Needs Node 24 and pnpm through corepack (`corepack enable`).

```bash
pnpm install
pnpm dev          # http://localhost:3000, data in ./data
pnpm test
pnpm check        # Biome: lint and format
pnpm docs:dev     # the site
```

## License

[MIT](./LICENSE).

<img src="https://fit.cvut.cz/static/images/fit-cvut-logo-en.svg" alt="FIT CTU logo" height="200">

This software was developed with the support of the **Faculty of Information Technology, Czech Technical University in Prague**.
For more information, visit [fit.cvut.cz](https://fit.cvut.cz/en).
