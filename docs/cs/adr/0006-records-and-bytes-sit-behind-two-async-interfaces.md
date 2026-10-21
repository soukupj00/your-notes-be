# Záznamy a bajty stojí za dvěma asynchronními rozhraními, takže si nasazení vybírá databázi i úložiště blobů

Dosud byl Drizzle nad better-sqlite3 jediným švem (seam) pro databázi a `PLAN.md` říkal, že rozhraní existuje jen tam, kde existuje druhá implementace.
Rozhodnuto 2026-09-30: server dodává dva backendy pro záznamy, SQLite (výchozí, pro stávající instalace beze změny) a PostgreSQL, a dva pro bajty, disk (výchozí) a objektové úložiště kompatibilní s S3.
Druhé implementace teď existují, takže si rozhraní své místo zasloužila.

Rozhraním pro záznamy je **Store** (úložiště záznamů).
Jeho tvar určuje doména (`accounts`, `sessions`, `codes`, `sync`, `blobRecords`, `shares`, `housekeeping`), ne tabulky, a každá metoda je asynchronní.
`transaction(fn)` spustí `fn` nad Store vázaným na transakci a po jejím doběhnutí provede commit.
ADR 0020 frontendu drží `transaction` mimo své lokální úložiště, protože IndexedDB a vzdálené úložiště ji nemohou obě zaručit; každá serverová databáze to umí, a bez ní by se pravidla pro push kopírovala do každého Store.
**BlobStore** si ponechává svůj tvar a vedle implementací pro disk a paměť dostává implementaci pro S3.
`DATABASE_URL` vybírá PostgreSQL a `BLOB_STORE=s3` spolu s endpointem, bucketem a klíči vybírá S3; když není nastaveno nic, znamená to SQLite a disk v `DATA_DIR`, jako dosud.
Každá implementace prochází jednou sdílenou sadou kontraktních testů pro své rozhraní a celá sada testů API běží proti oběma Store.

Pravidla zjištěná spikem 2026-09-30, která dodržuje každá implementace:

- better-sqlite3 neumí spustit asynchronní transakci (Drizzle vyhodí „Transaction function cannot return a promise“) a ruční `BEGIN` na jeho jediném spojení dovolil souběžnému požadavku přečíst nedokončený push a při rollbacku přijít o vlastní zápis.
  SQLite Store proto pouští každé volání přes jeden asynchronní zámek, obal kolem Store místo kódu v každé metodě; u triviálních čtení to stálo asi 3,5 %.
- Volání vnějšího Store uvnitř `transaction(fn)` by pod SQLite čekalo na vlastní zámek, proto místo zablokování vyhodí chybu.
- Žádné bajtové ani síťové I/O uvnitř transakce: pod SQLite by se po celou dobu držel zámek pro všechny požadavky.
- PostgreSQL izoluje transakce, ale ne pořadové číslo (Sequence), takže push zamyká řádek svého účtu a dva pushe nemohou rozdat stejné pořadové číslo.
  Doplněno 2026-10-01: push bere `FOR NO KEY UPDATE`, takže vkládání, která na účet jen odkazují (přihlášení, nahrávání), nečeká, a stránka proudu změn (change feed) bere `FOR SHARE`, takže nikdy nevrátí řádek nad pořadovým číslem, které hlásí.
  Testuje se to proti skutečnému PostgreSQL, protože PGlite spouští jen jednu transakci naráz a souběh ukázat nedokáže.
- Časová razítka zůstávají v obou databázích textem ISO 8601, protože je kód porovnává jako řetězce.
- Store převádí porušení unikátních klíčů své databáze na vlastní chyby serveru.
- Doplněno 2026-10-01: žádná chyba neopustí Store s citací hodnot svého dotazu, které obsahují těla poznámek a haše hesel a tokenů.
- SQL specifické pro daný engine (`json_each`, dvouargumentové `max`) žije jen ve svém Store.
  Ovladače a SDK se importují jen pod `src/infra/`, což vynucuje Biome, a načítají se dynamickým `import()`, takže instalace se SQLite a diskem nikdy nenačte `pg` ani AWS SDK.

Každá databáze má vlastní schéma Drizzle a migrace (`drizzle/sqlite/`, `drizzle/postgres/`), takže dotazy se píší jednou pro každou databázi.
Tato duplicita je cena za typovaná schémata pro každou databázi; sada kontraktních testů drží obě implementace v souladu a zároveň je ukázkovým příkladem, jak přidat databázi.

Server běží jako **jedna instance**.
Signály živých aktualizací, čítače rate limitů, denní úklid a kód pro první nastavení žijí v procesu a druhou instanci při startu odmítne zámek: advisory lock u PostgreSQL, zámek na `younotes.lock` v `DATA_DIR` u SQLite.
Běh více instancí by vyžadoval `LISTEN/NOTIFY` pro signály a sdílené úložiště pro rate limity; registr živých aktualizací stojí za malým rozhraním, aby to šlo později doplnit.
Doplněno 2026-10-01, jen formulace: registr je jedna třída, `LiveUpdates`, bez rozhraní před ní; její tři metody (`add`, `notify`, `closeAll`) jsou šev, který by verze s `LISTEN/NOTIFY` zachovala.

**Záloha serveru a přesun mezi backendy mají jeden formát.**
`backup <dir>` zapíše do přenositelné složky každý záznam, přečtený v jedné transakci, a pak bajty, které tyto záznamy uvádějí: jeden soubor JSON Lines na tabulku, bloby a manifest s verzí formátu.
`restore <dir>` ji nahraje do prázdného Store a BlobStore a `migrate` udělá obojí v jednom kroku, například ze SQLite na disku do PostgreSQL a S3.
Pořadové číslo a ořezané pořadové číslo každého účtu se kopírují přesně, takže kurzory zařízení zůstanou platné, a relace se kopírují, takže zařízení zůstanou přihlášená; párovací kódy ne, protože žijí jen minuty.
`pg_dump` a verzování bucketů jsou zdokumentované jako nativní alternativy a `VACUUM INTO` odchází.

Zvažováno a zamítnuto:

- Kysely, jeden query builder pro obě databáze: přepisuje každý dotaz a skrývá příklad pro jednotlivé databáze, který má tato změna ukázat.
- Store v paměti: SQLite v paměti je už rychlé a je to skutečná databáze.
- Obecný `Repository<T>`: agregáty toho mají společného málo víc než název.
- Ponechat Drizzle jako jediný šev: jeho synchronní API a SQL jen pro SQLite prosakují ke každému volajícímu, takže druhá databáze by se dotkla každého souboru.
