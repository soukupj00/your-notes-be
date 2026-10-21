# Struktura

```
src/
  contract/index.ts   the shared Zod contract; the frontend vendors this file
  config.ts           environment variables to a validated Config
  server.ts           buildServer(): builds every service once over the Store and BlobStore it is given, registers the routes, never listens
  main.ts             makes the logger, opens the Store and BlobStore the config names, sweeps daily, listens, prints the first-run Pairing Link, closes the Store on shutdown
  cli.ts              backup <dir>, restore <dir>, migrate (to the TARGET_ variables), reset-owner-password
  version.ts          the server's version, read from package.json
  modules/<feature>/  routes.ts (HTTP only), service.ts (the rules), presenter.ts (records to HAL bodies)
    accounts          Local Accounts: creating the Owner and members, listing, password reset
    sessions          sign-in, Sessions and the Devices behind them
    pairing           Pairing Codes and the first run
    sync              push and feed; decide.ts (the sync rules, pure), liveUpdates.ts (the open SSE streams)
    blobs             Attachment bytes
    shares            Share Links
    housekeeping      the daily sweep (old Tombstones raising the pruned Sequence, Sessions, Pairing Codes, orphan blobs) and the /health ping
    backup            the Server Backup, no routes: service.ts (backup, restore, migrate), format.ts (the directory: manifest, JSON Lines, blobs)
    meta              the HAL root and /health, routes only
  store/              Store.ts (the records interface), records.ts (what it takes and returns), BlobStore.ts (the bytes interface), one contract suite each (the Store's is store.contract.test.ts plus sync.contract.test.ts), and one for serverBackup
  infra/              open.ts (picks the Store and BlobStore from the config, and says where each keeps its data), guarded.ts (the transaction rules: no outer Store inside, no tx after; no error quoting query values), rows.ts (rows to records and the Server Backup's paging, both databases), waitFor.ts (waiting at startup for PostgreSQL or S3)
  infra/sqlite/       schema.ts, client.ts, migrate.ts, store.ts (the Store), lock.ts (its one async lock), serverBackup.ts (its serverBackup group), instanceLock.ts (one server per DATA_DIR)
  infra/postgres/     schema.ts, client.ts (waiting for the database, the advisory locks, the pool), migrate.ts, store.ts (the Store), serverBackup.ts; loaded only with DATABASE_URL
                      testing.ts (PGlite and throwaway databases for tests; not built)
  infra/blobs/        disk.ts, memory.ts, s3.ts (loaded only when BLOB_STORE=s3), testing.ts (the S3 test bucket; not built)
  http/               what routes share: auth and security hooks, errors, docs, static (PWA), hal, etag, session cookie, sendBlob
  shared/             crypto (secrets and their SHA-256), passwords (scrypt), clock, errors (the server's, no HTTP), warn (the warning callback's type)
  test/               helpers.ts (the test Store and server, the sign-up steps, the shared builders, must, push and pull), storeContract.ts (the Store contract's records and the Stores it runs on), pglite.setup.ts (boots a file's PGlite before its first test), the API tests, serverBackup.test.ts (across Stores and BlobStores), concurrency.test.ts (real PostgreSQL only)
drizzle/sqlite/, drizzle/postgres/   generated migrations, applied when the Store opens
scripts/openapi.ts    writes docs/openapi.json
```

## Pravidla

- Soubor s routami řeší jen HTTP: schémata, autentizaci, stavové kódy, cookies a hlavičky.
- Služba (service) je třída, která dostane vše potřebné v konstruktoru a o Fastify nic neví (ADR 0007).
- `server.ts` sestaví každou službu jednou a předá je routám jako `app.services`.
- Služby vyhazují chyby ze `shared/errors.ts` a `http/errors.ts` z nich dělá problem details.
  `sendProblem` zůstává hookům, handleru pro nenalezené cesty a routám pro bloby, jejichž předčasné odpovědi popisuje [`http.md`](http.md).
- Žádný soubor s routami neimportuje jiný; co sdílejí dvě funkční oblasti, žije v `http/`, `shared/` nebo v presenteru.
- Služby se k záznamům dostávají jen přes asynchronní `Store` (úložiště záznamů, ADR 0006), tvarovaný podle domény, a jeho záznamy nenesou žádné SQL nully ani typy Drizzle.
- Jen `src/infra/` importuje `drizzle-orm`, `better-sqlite3`, `pg`, `@electric-sql/pglite` nebo `@aws-sdk/*` (kontraktové sady to smějí kvůli přípravě skutečných backendů) a nic pod `src/modules/`, `src/http/`, `src/store/` ani `src/shared/` neimportuje `src/infra/`; jinak build shodí pravidlo `noRestrictedImports` v Biome.
- `infra/open.ts` načítá PostgreSQL a S3 dynamickým `import()`, takže instalace se SQLite a diskem jejich ovladače nikdy nenačte.
- Práce, která se nesmí prolínat s jiným požadavkem, běží v jedné `transaction(fn)` a před prvním čtením si vezme `accounts.lock`; uvnitř se používá jen `tx` a neprobíhá žádné bajtové ani síťové I/O.
  Pravidla a to, jak je dodržuje každá databáze, popisuje [`transactions.md`](transactions.md).
- Záloha serveru čte všechny záznamy v jednom snapshotu přes `serverBackup.read` (SQLite: odložená čtecí transakce, která díky WAL neblokuje zapisovatele serveru; PostgreSQL: REPEATABLE READ) a bajty kopíruje až po jejím skončení.
  `restore` a `migrate` zapisují nejdřív bajty, pak všechny záznamy v jednom `serverBackup.write`, a to jen do prázdného Store a BlobStore; při selhání smažou bajty, které zapsaly, takže opakovaný pokus najde cíl prázdný.
- `buildServer()` dostává konfiguraci, Store a BlobStore jako argumenty a nikdy nevolá `listen()`.
- Testy spouštějí skutečnou aplikaci přes `app.inject()` proti skutečnému Store, nikdy proti mocku, a unit test leží vedle toho, co testuje.
  Dva projekty Vitestu, kontraktové sady a proměnné, které přidávají skutečný PostgreSQL a S3, popisuje [`testing.md`](testing.md).
- `src/contract/index.ts` importuje jen `zod`, protože běží i v prohlížeči.
- Požadavky se validují na hranici schématy z kontraktu a každá chyba odchází jako problem details podle RFC 9457.
- `docs/openapi.json` a `drizzle/` jsou generované; CI selže, když je některý z nich zastaralý.
- Soubory mají méně než 500 řádků.
