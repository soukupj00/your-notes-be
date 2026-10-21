# Architektura

Jak je server postavený, jedna krátká stránka na téma.
Rozhodnutí a jejich důvody jsou v [`../adr/`](../adr/); plán je v [`PLAN.md`](https://github.com/soukupj00/your-notes-be/blob/main/PLAN.md).

1. [Struktura](structure.md): strom zdrojových kódů a pravidla, která ho udržují jednoduchý.
2. [Přidání Store](adding-a-store.md): nová databáze nebo úložiště blobů, od rozhraní po zapojení.
3. [Synchronizace](sync.md): pravidla pro push, tombstony (záznamy o smazání), proud změn (change feed) a živé aktualizace.
4. [Transakce a zámky](transactions.md): co slibují `transaction(fn)` a `accounts.lock` a jak to dodržují SQLite a PostgreSQL.
5. [Bloby](blobs.md): bajty přílohy od nahrání po úklid.
6. [HTTP](http.md): pořadí hooků, odpovědi, které je přeskakují, ETagy a problem details.
7. [Testování](testing.md): dva projekty Vitest, kontrakty napříč implementacemi Store a proměnné, které přidají skutečný PostgreSQL a S3.
