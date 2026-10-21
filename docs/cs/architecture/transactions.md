# Transakce a zámky

Co slibují `transaction(fn)` a `accounts.lock` a jak tento slib dodržuje každá databáze.
Rozhraní je `src/store/Store.ts`; pravidla vynucuje `src/infra/guarded.ts`; mechanika leží v `src/infra/sqlite/` a `src/infra/postgres/`.
Experiment (spike), který tato pravidla odhalil, je ADR 0006.

## Pravidla na každé databázi

- Každé volání Store (úložiště záznamů) je asynchronní a `transaction(fn)` spouští `fn` proti `tx` vázanému na jednu transakci: commit, když se `fn` vyřeší (resolve), rollback a opětovné vyhození chyby, když skončí odmítnutím (reject).
- Uvnitř `fn` se používá jen její `tx`.
  Vnější Store tam vyhodí chybu (`guarded.ts`), protože pod SQLite by čekal na zámek, který drží jeho vlastní transakce, a pod PostgreSQL by běžel mimo transakci.
  `tx` ponechaný po skončení `fn` vyhodí chybu také.
  Metoda služby, která se připojuje k transakci jiné metody, dostává `tx` jako parametr.
- Čtení uvnitř transakce vidí, co ostatní commitnuli (READ COMMITTED), takže práce, která se nesmí prolínat s jiným požadavkem, si před prvním čtením vezme `accounts.lock(id, mode)`; čtení provedené dřív nevidí, co commitne předchozí držitel.
  `write` vylučuje všechny ostatní držitele, `read` jen zapisovatele.
- Uvnitř transakce žádné bajtové ani síťové I/O: pod SQLite zámek mezitím blokuje všechny ostatní požadavky.
  Signály živých aktualizací odcházejí až po commitu.
- Žádná chyba neopustí Store s citací hodnot svého dotazu; `guarded.ts` odstraní výpis parametrů z Drizzle a ponechá jen zprávu databáze.

Kdo bere jaký zámek:

| Práce | Zámek |
|---|---|
| odeslání změn (push) | `write` |
| stránka proudu změn (change feed) | `read` |
| vytvoření odkazu pro sdílení | `write` |
| vytvoření účtu z kódu, záznamy úklidu | transakce, bez zámku |

## SQLite

better-sqlite3 je synchronní na jednom spojení a Drizzle na něm odmítá asynchronní transakci.
Proto SQLite Store pouští každé volání, včetně celé `transaction(fn)`, přes jeden asynchronní zámek (`lock.ts`); vlastní `accounts.lock` tohoto Store je no-op, protože ten jeden zámek už drží všechny účty.
Režie naměřená ve spiku byla asi 3,5 % u triviálních čtení.

- `transaction(fn)` začíná `BEGIN IMMEDIATE`, takže když je databáze zaneprázdněná jiným procesem (CLI), čeká se u `BEGIN` až `busy_timeout` (5 s), místo aby transakce selhala uprostřed.
- `serverBackup.read` otevírá odložený `BEGIN`: nebere žádný zápisový zámek a pod WAL zapisovatelé z ostatních spojení pokračují, zatímco jeho snapshot nevidí žádný z jejich commitů.
  `serverBackup.write` je opět `BEGIN IMMEDIATE`.
- Soubor běží s WAL, zapnutými cizími klíči a `busy_timeout`; viz `client.ts`.
- Zámek instance je exkluzivní transakce držená otevřená na `yournotes.lock` vedle databáze (`instanceLock.ts`), takže druhý server na stejném `DATA_DIR` je při startu odmítnut, a berou ho i `restore` a `migrate`, takže odmítnou běžet, dokud běží server.
  Jádro ho uvolní spolu s procesem, takže spadlý server nikdy nezablokuje další start.
  PID v souboru by to nedokázal: server v containeru má při každém startu pid 1 a CLI běží ve vlastním containeru.

## PostgreSQL

Transakce izoluje databáze, takže kolem volání není žádný zámek; pool je spouští souběžně.

- `accounts.lock(id, 'write')` je `SELECT ... FOR NO KEY UPDATE` na řádku účtu, `'read'` je `FOR SHARE`.
  `NO KEY UPDATE` místo `UPDATE` proto, že řádek odkazující na účet (přihlášení, nahrání) bere pro svůj cizí klíč `KEY SHARE` a nemusí čekat na push.
- `serverBackup.read` běží v `REPEATABLE READ`, `READ ONLY`: jeden snapshot, který zápisy serveru nemění a na který ani nečekají.
- Dva advisory locky s klíčem `"YouN"` plus číslo: zámek instance, braný přes `pg_try_advisory_lock` na spojení, které server drží otevřené po celou dobu běhu, takže druhý server je při startu odmítnut, a berou ho i `restore` a `migrate`, takže odmítnou běžet, dokud běží server; a zámek migrací kolem `migrate`.
- PGlite, na kterém běží API testy, provádí vždy jen jednu transakci, takže souběh dvou pushů ukázat nemůže.
  `src/test/concurrency.test.ts` je proto spouští jen proti skutečnému PostgreSQL (`PG_TEST_URL`).

Konflikty zámků mezi dvěma transakcemi na jednom účtu:

| drží \ chce | `write` | `read` | insert odkazující na účet |
|---|---|---|---|
| `write` | čeká | čeká | pokračuje |
| `read` | čeká | pokračuje | pokračuje |
