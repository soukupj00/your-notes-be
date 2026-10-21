# Přidání Store

Záznamy leží za rozhraním `Store` (úložiště záznamů) a bajty za `BlobStore` (ADR 0006).
SQLite a PostgreSQL jsou hotové příklady prvního, disk a S3 druhého.
Přidání dalšího backendu se dotkne tří míst a ničeho v `src/modules/` ani `src/http/`.

## 1. Implementace rozhraní

Implementace patří do `src/infra/<name>/`, jediného místa, které smí importovat její ovladač; jinak build shodí pravidlo `noRestrictedImports` v Biome.
Balíček ovladače se přidá do obou seznamů v `biome.json`: do toho na nejvyšší úrovni a do toho v override pro `src/modules/**`, `src/http/**`, `src/store/**` a `src/shared/**`, který ho tam nahrazuje.
Store implementuje `src/store/Store.ts` a vrací prosté záznamy z `src/store/records.ts`: žádné SQL nully, žádné typy ovladače.
U SQL databáze to znamená vlastní schéma Drizzle zrcadlící ostatní dvě, vlastní migrace v `drizzle/<name>/` s vlastní konfigurací drizzle-kit přidanou do `pnpm db:generate` a vlastní dotazy; `src/infra/rows.ts` už převádí řádky na záznamy, pokud schéma dává stejné řádky.

Pravidla, která dodržuje každý Store, všechna zdokumentovaná v `Store.ts`:

- Každé volání je asynchronní a `transaction(fn)` spouští `fn` proti Store vázanému na jednu transakci.
- Volání vnějšího Store uvnitř `fn` vyhodí chybu, stejně jako `tx` ponechaný po skončení své transakce; obalením Store funkcí `guarded()` ze `src/infra/guarded.ts` se obojí získá zadarmo.
  Každá skupina je prostý objekt funkcí, které nepoužívají `this`, protože `guarded()` obaluje vlastní vlastnosti skupiny a volá je nenavázané.
- `accounts.lock(id, mode)` drží účet až do konce transakce, a právě to brání tomu, aby dvě odeslání změn (push) dostala stejné pořadové číslo (Sequence) a aby stránka proudu změn (change feed) sahala za své vlastní pořadové číslo.
  Databáze, která spouští vždy jen jednu transakci, jako SQLite za svým zámkem, ho implementuje jako prázdnou operaci.
- Časová razítka jsou text ve formátu ISO 8601 a porovnávají se jako řetězce.
- Porušení unikátního klíče nikdy neunikne jako chyba ovladače: obsazené uživatelské jméno vyhodí `UsernameTaken`, dvakrát zaznamenaný blob je no-op a vytvoření odkazu pro sdílení drží účet, takže druhé vytvoření najde to první.
- Žádná chyba neopustí Store s citací hodnot svého dotazu, které obsahují těla poznámek a hashe hesel a tokenů.
  `DrizzleQueryError` z Drizzle cituje každý parametr, proto ho `guarded()` nahrazuje vlastní zprávou databáze, ponechanou beze změny, protože validace na hranici nepustí dovnitř chybně formátované hodnoty, které by databáze citovala ("invalid input syntax"); ovladač, který cituje hodnoty jinde, potřebuje totéž.
- SQL specifické pro daný databázový engine zůstává ve Store.
- Server běží jako jedna instance (ADR 0006).
  Store odmítne druhý server při startu, jak to dělá advisory lock v PostgreSQL a `younotes.lock` u SQLite (`holdInstanceLock` v `src/infra/postgres/client.ts` a `src/infra/sqlite/instanceLock.ts`), a `restore` a `migrate` berou stejný zámek, takže odmítnou běžet, dokud běží server (`StoreOptions.oneInstance` v `src/infra/open.ts`).
- Skupina `serverBackup` je součástí Store: čte každou tabulku celou, tak jak je uložená, v jednom snapshotu, který neblokuje zapisovatele serveru, a zapisuje celou zálohu serveru do prázdného Store v jedné transakci.
  Verze pro SQLite a PostgreSQL leží ve vlastních `serverBackup.ts`; každá mapuje druhy z `BACKUP_KINDS` na své tabulky a čte stránku v pořadí primárního klíče a zbytek obstarají `recordsOf` a `writeEach` v `src/infra/rows.ts`.

BlobStore implementuje `src/store/BlobStore.ts` v `src/infra/blobs/<name>.ts`: bajty zapisované podle id jen jednou, kontrolu velikosti dřív, než se zápis započítá, a výpis pro úklid.

## 2. Splnění kontraktové sady

Nový backend se přidá do `eachStore()` v `src/test/storeContract.ts`, na kterém běží každý kontraktový soubor pro Store, a do seznamu v `serverBackup.contract.test.ts`, u BlobStore do seznamu v `blobStore.contract.test.ts`.
Kontrakt `serverBackup` kopíruje každý záznam do každého jiného Store a u databáze, která spouští transakce souběžně, ověřuje snapshot z druhého spojení.
Backend, který potřebuje server, běží jen tehdy, když na něj ukazuje proměnná `*_TEST_*`, jako `PG_TEST_URL` a `S3_TEST_ENDPOINT`; CI takový server spouští jako službu testovacího jobu.
Kontraktový test se nikdy neoslabuje, aby implementace prošla; když nový backend potřebuje novou metodu, dostane ji každá implementace a kontrakt ji otestuje.

Pokud databáze spouští transakce souběžně, je třeba ji pokrýt i v `src/test/concurrency.test.ts`: tyto souběhy ukáže jen skutečný server.
Ten soubor běží jen proti PostgreSQL a nemá žádný seznam backendů, takže je potřeba mu ho přidat, nebo novou databázi pokrýt vlastním blokem.
Aby celá sada API testů běžela na novém Store, dostane `testStore()` v `src/test/helpers.ts` větev pro něj a `vitest.config.ts` nový projekt Vitestu, jako ho má PGlite.
`otherStore()` v `src/test/serverBackup.test.ts` má napevno přecházení mezi SQLite a PGlite; i ten dostane větev, aby testy zálohování na úrovni API přecházely i do nového Store.

## 3. Zapojení

`src/infra/open.ts` vybírá Store a BlobStore podle konfigurace, pro `main.ts` i `cli.ts`.
Přidá se tam větev, která nový backend načte dynamickým `import()`, takže instalace, která ho nezvolí, nikdy nenačte jeho ovladač.
Switche v tomto souboru nemají větev `default`, takže `tsc` vyjmenuje každý, který je třeba rozšířit: `openStore` nebo `openBlobStore` a `storeLocation` nebo `blobStoreLocation`, které `migrate` říkají, zda je cíl jiné místo.
Nastavení backendu patří do `src/config.ts` (validovaná, v chybách pojmenovaná, ale nikdy nevypisovaná, a přidaná do `REDACT`, pokud nesou tajemství), `compose.yml`, `.env.example` a `docs/setup-backends.md`.
