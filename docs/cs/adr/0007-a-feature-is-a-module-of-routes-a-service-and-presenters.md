# Funkce je modul z rout, služby a presenterů a routy nikdy nesahají na Store

Dosud soubor s routou parsoval požadavek, dotazoval se Drizzle, uplatňoval pravidla a sestavoval tělo HAL a soubory s routami si navzájem importovaly pomocné funkce (`setup.ts` z `accounts.ts` a `session.ts`, `shares.ts` z `blobs.ts`).
Rozhodnuto 2026-09-30: `src/modules/<feature>/` obsahuje pro danou funkci `routes.ts` (jen HTTP: schémata, autentizace, stavové kódy), `service.ts` (pravidla) a `presenter.ts` (převod záznamů na těla HAL).
Služba je třída, která v konstruktoru dostane svůj Store, BlobStore, hodiny a konfiguraci, takže čtenář najde pravidlo na jednom místě a test si ji může sestavit s čímkoli.
`src/http/` obsahuje to, co sdílejí všechny routy (autentizace, bezpečnostní hlavičky, mapování chyb, HAL, ETag), `src/infra/` implementace Store a BlobStore (ADR 0006) a `src/shared/` drobné pomocné funkce, které nemají jiný domov (tajemství a hašování, hodiny, chyby).

`server.ts` je jediné místo, které sestavuje Store a služby a předává je routám přes Fastify `app.decorate`; víc dependency injection tento server nepotřebuje.
Služby vyhazují vlastní chyby serveru (`NotFound`, `Conflict`, `Forbidden`, ...) a jediný error handler z každé udělá problem details, takže handler nikdy sám chybovou odpověď nesestavuje.
Chování, které prochází napříč rozhraním, například zámek SQLite, je obal implementující totéž rozhraní.
`modules/sync/decide.ts` zůstává čistý a `src/contract/index.ts` si ponechává svou cestu, protože frontendový `contract:pull` ho čte odtamtud.
`main.ts`, `cli.ts`, `server.ts` a `config.ts` zůstávají v kořeni `src/`, takže `node dist/cli.js` ani příkaz image se nemění.

Zvažováno a zamítnuto:

- TypeScriptové dekorátory pro routy a injection (styl NestJS): potřebují zastaralé `experimentalDecorators` a `reflect-metadata` a nahrazují schémata Zod, která dnes typují každý handler; přijmout je znamená přijmout NestJS.
- Kontejner pro dependency injection: jedna kompoziční funkce propojí všechny objekty, které server má.
- Abstraktní bázové třídy pro služby nebo routy: nesdílely by žádné chování.
