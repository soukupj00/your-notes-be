# Testování

Jak testy běží na skutečných databázích a úložištích a které proměnné přidávají servery, které má CI.
`vitest.config.ts` definuje dva projekty; `src/test/helpers.ts` sestavuje aplikaci, se kterou API testy mluví; `src/test/storeContract.ts` spouští kontrakt Store (úložiště záznamů) na každém Store.
Testovací databáze a testovací bucket S3 jsou v `src/infra/postgres/testing.ts` a `src/infra/blobs/testing.ts`, které jsou vynechané z buildu.

| Testy | Store | Úložiště blobů | Běží, když |
|---|---|---|---|
| unit testy vedle svého kódu | žádný, nebo SQLite | žádné | vždy, projekt `sqlite` |
| API testy a testy služeb | SQLite v paměti a PGlite | paměť | vždy, projekty `sqlite` a `pglite` |
| kontrakty Store: `store`, `sync`, `serverBackup` | SQLite, PGlite, PostgreSQL | žádné | PostgreSQL s `PG_TEST_URL` |
| kontrakt BlobStore | žádný | paměť, disk, S3 | S3 s `S3_TEST_ENDPOINT` |
| `serverBackup.test.ts` | napříč SQLite a PGlite | disk, paměť, S3 | S3 s `S3_TEST_ENDPOINT` |
| `concurrency.test.ts` | PostgreSQL | paměť | jen s `PG_TEST_URL` |
| `cli.test.ts` | soubory SQLite, PostgreSQL | disk | PostgreSQL s `PG_TEST_URL` |

## Dva projekty, jeden PGlite na soubor

- Projekt `sqlite` spouští každý testovací soubor; projekt `pglite` spouští API testy a testy služeb znovu s `TEST_STORE=pglite`, které čte `testStore()`.
  Kontraktové sady procházejí všechny Store samy, takže běží jen v `sqlite`.
- Pod `pglite` vrací `testStore()` jediný PGlite daného souboru, jednou zmigrovaný a při každém volání vyprázdněný; jeho `close` nechá databázi otevřenou pro další test.
  Past: druhé volání `testStore()` v jednom testu vyprázdní první Store, takže test, který potřebuje dva Store, si vezme jinou databázi, jako to dělá `otherStore()` v `serverBackup.test.ts`.
- `pglite.setup.ts` nastartuje tento PGlite před prvním testem souboru, takže start nezatíží timeout žádného testu; `eachStore()` a `serverBackup.test.ts` startují své PGlite stejně.

## Skutečné servery

- `PG_TEST_URL` určuje server PostgreSQL, na kterém smějí testy vytvářet databáze; vytvářejí si vlastní pod náhodnými názvy a po skončení je smažou.
  Přidává PostgreSQL do kontraktů Store a zálohy serveru a do testů CLI a spouští `concurrency.test.ts`.
- `S3_TEST_ENDPOINT` přidává S3 do kontraktu BlobStore a do `serverBackup.test.ts`, spolu s `S3_TEST_ACCESS_KEY_ID`, `S3_TEST_SECRET_ACCESS_KEY` a `S3_TEST_BUCKET` (výchozí `younotes-test`, vytvoří se, pokud chybí).
  Každé úložiště blobů na S3 dostane náhodný prefix klíčů a soubor smaže, co zapsal, takže testy ani běhy nikdy nekolidují.
- CI spouští PostgreSQL a SeaweedFS jako služby testovacího jobu a nasměruje na ně proměnné; bez nich `pnpm test` tyto testy přeskočí a spustí zbytek.
- PGlite provádí vždy jen jednu transakci, takže souběhy mezi požadavky se ukážou jen na skutečném PostgreSQL.
  `concurrency.test.ts` volá služby přímo; kde musí odeslání změn (push) čekat za stránkou proudu změn (change feed), opakovaně se dotazuje, dokud PostgreSQL nehlásí, že čeká na zámek (`lockWaiters`), a nikdy nečeká pevně danou dobu.

## Kontrakty napříč Store

- `eachStore()` deklaruje každou kontrolu jednou pro každý Store; každá kontrola začíná s účty `a` (vlastník) a `b`.
  Nový Store se připojí tím, že se tam přidá, jak popisuje [`adding-a-store.md`](adding-a-store.md).
- Kontrakt `serverBackup` kopíruje každý záznam z každého Store do každého jiného a na souboru SQLite i na PostgreSQL ověřuje, že `read` drží jeden snapshot, zatímco druhé spojení commituje.
- `serverBackup.test.ts` přechází přes API: `testStore()` každého projektu je zdrojem a `otherStore()` cílem, takže běží oba směry.

## Pomocné funkce

- `testServer()` sestaví skutečnou aplikaci pro `app.inject()` nad čerstvým Store a úložištěm blobů v paměti, nebo nad předanými; předaný Store zůstane otevřený, když se aplikace zavře.
- `src/test/helpers.ts` obsahuje také buildery API (`note`, `tag`, `link`, `batch`), `push` a `pull`, kroky registrace, `expectProblem` a `must`, která při selhání pojmenuje chybějící hodnotu.
- `src/test/storeContract.ts` má vlastní buildery ve tvaru uložených záznamů s `rev`, zatímco buildery API mají tvar, v jakém data posílá zařízení.
- Databáze se nikdy nemockuje: stav se připravuje a kontroluje přes Store.
