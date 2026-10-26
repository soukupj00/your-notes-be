# Pro vývojáře

Server je aplikace ve Fastify v TypeScriptu, která udržuje poznámky domácnosti v souladu napříč jejími zařízeními a ze stejného originu servíruje sestavenou aplikaci.
Běží jako jeden proces Node 24 v containeru, před kterým stojí Caddy kvůli TLS ([ADR 0004](../adr/0004-the-backend-image-takes-the-pwa-from-the-frontend-image.md)).
Aplikace má [vlastní repozitář](https://github.com/soukupj00/your-notes-fe) a [vlastní stránky pro vývojáře](https://soukupj00.github.io/your-notes-fe/cs/developers/).

## Jak je postavený

Každá funkce je modul v `src/modules/<feature>/`: `routes.ts` řeší jen HTTP, `service.ts` drží pravidla a `presenter.ts` převádí záznamy na HAL těla ([ADR 0007](../adr/0007-a-feature-is-a-module-of-routes-a-service-and-presenters.md)).
`server.ts` sestaví každou službu jednou a předá je routám, a `buildServer()` nikdy neposlouchá, takže testy ovládají skutečnou aplikaci přes `app.inject()`.

Služby se k záznamům dostanou jen přes asynchronní rozhraní `Store` a k bajtům jen přes `BlobStore` ([ADR 0006](../adr/0006-records-and-bytes-sit-behind-two-async-interfaces.md)).
SQLite a soubory na disku jsou výchozí, PostgreSQL a S3 bucket druhé implementace, a driver nebo SDK importuje jen `src/infra/`, což vynucuje Biome.
Pravidla synchronizace v `src/modules/sync/decide.ts` jsou čisté funkce a `src/contract/index.ts` obsahuje Zod schémata, která si aplikace stahuje do svého repozitáře.

## Vývoj

Potřebuje Node 24 a pnpm přes corepack (`corepack enable`).

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

CI selže, když je `docs/openapi.json` nebo migrace zastaralá.
Dvě proměnné přidají do testů skutečný PostgreSQL a S3 a bez nich se tyto testy přeskočí; podrobnosti jsou v [Testování](../architecture/testing.md).

`pnpm dev` servíruje jen API, dokud v `./public` není sestavená PWA, například `cp -r ../ni-dip-fe/dist public`, kde `../ni-dip-fe` je repozitář frontendu checkoutnutý vedle tohoto.
Reference API je na `/api/docs`; tentýž dokument je na stránce [API](api.md) a je commitnutý jako `docs/openapi.json` pro import do libovolného HTTP klienta.

### Image bez Caddy

`docker compose --profile local build` sestaví image z tohoto checkoutu přes `compose.override.yml`, který mají jen vývojáři; pokud image frontendu nelze stáhnout, nastavte `FE_IMAGE` v `.env`.
Server samotný bez Caddy na `http://localhost:3000` vyzkoušíte takto:

```bash
docker compose --profile local up yournotes-local
```

`--profile` nahrazuje `COMPOSE_PROFILES`, takže pokud ho `.env` nastavuje, uveďte i tyto profily, například `docker compose --profile local --profile postgres up yournotes-local`; jinak server čeká na databázi, která se nikdy nespustí.
Zastavte ho se stejnými přepínači: `docker compose --profile local down`, nebo `docker compose --profile local --profile postgres down`.
Prosté `docker compose down` ho nechá na místě, ale bez jeho sítě, a jeho další spuštění selže.
Ostrý provoz s Caddy popisuje [návod k nastavení](../setup.md).

### Vyzkoušení na telefonu

Telefony spouštějí aplikaci jen přes `https`, takže `http://localhost:3000` nestačí.
S Tailscale na tomto počítači i na telefonu (se zapnutými HTTPS Certificates, viz [Tailscale v návodu k nastavení](../setup.md#3a-tailscale-doporuceno)) dá `tailscale serve` vývojovému serveru skutečný certifikát bez Dockeru:

```bash
# 1. Build the app and let the server serve it; repeat after every frontend change
(cd ../ni-dip-fe && pnpm build) && rm -rf public && cp -r ../ni-dip-fe/dist public

# 2. Start the server with the machine's tailnet name, so the Pairing Link points there
PUBLIC_URL=https://<machine>.<tailnet>.ts.net TRUST_PROXY=true pnpm dev

# 3. In a second terminal, once: https on the tailnet name, forwarded to port 3000
sudo tailscale serve --bg 3000
```

Celé jméno počítače je na stránce Machines v administrační konzoli Tailscale nebo ve výstupu `tailscale serve status`.
Při prvním spuštění `tailscale serve` vypíše odkaz pro povolení Serve v tailnetu; otevřete ho a příkaz spusťte znovu.
Funnel nechte vypnutý: vystavil by vývojový server na veřejný internet.

Na prvním zařízení otevřete párovací odkaz z logu, čímž vytvoříte vlastníka; funguje jednou.
Každé další zařízení přidejte z přihlášeného zařízení v Nastavení, Účet, Zařízení, „Přidat zařízení“.
`./data` uchovává účty i po restartu; smažte ho, chcete-li začít znovu.
`sudo tailscale serve --https=443 off` servírování ukončí.

## Release

1. Zvyšte `version` v `package.json` a mergněte do `main`.
2. Otagujte tento commit jako `v0.x.y` a pushněte tag; CI sestaví image, provede smoke testy a publikuje ji pod tímto tagem.
3. Nastavte `YOURNOTES_VERSION` v `.env.example` na nový tag, aby nové instalace začínaly na něm; [návod k nastavení](../setup.md#4-spusteni) stahuje soubory také z tagu, takže aktualizujte jeho tři řádky s `curl`.

Každý push do `main` také publikuje tento web na GitHub Pages.

## Čtěte dál

- [API](api.md): HAL, problem details, session cookie, synchronizační routy a úplná reference.
- [Architektura](../architecture/), jedna krátká stránka na téma: [Struktura](../architecture/structure.md), [Přidání Store](../architecture/adding-a-store.md), [Synchronizace](../architecture/sync.md), [Transakce a zámky](../architecture/transactions.md), [Bloby](../architecture/blobs.md), [HTTP](../architecture/http.md) a [Testování](../architecture/testing.md).
- [Rozhodnutí](../adr/): co se v tomto repozitáři rozhodlo a proč.
