# Rozhodnutí

Každý záznam popisuje jedno rozhodnutí přijaté v tomto repozitáři, proč bylo přijato a co bylo zamítnuto.
Pozdější změna záznam upraví na místě a uvede, kdy se tak stalo.
Rozhodnutí samotné aplikace jsou na [webu aplikace](https://soukupj00.github.io/your-notes-fe/cs/adr/); tento server přebírá její ADR 0017, 0018 a 0020 jako daná.

1. [Vlastníka vytvoří párovací odkaz vypsaný při prvním spuštění](0001-the-owner-is-created-by-a-printed-pairing-link.md) a tytéž jednorázové kódy párují zařízení a nesou pozvánky.
2. [Proud změn se čte přímo z řádků](0002-the-change-feed-is-read-from-the-rows-not-from-a-log.md), ne z logu změn.
3. [Metadata příloh jsou JSON sloupec v poznámce](0003-attachment-metadata-is-a-column-on-the-note.md); vlastní tabulku dostává jen vlastnictví blobů.
4. [Backendový image přebírá sestavenou PWA z publikovaného frontendového image](0004-the-backend-image-takes-the-pwa-from-the-frontend-image.md) a Caddy je jediná proxy.
5. [Tokeny odkazů pro sdílení se ukládají v čitelné podobě](0005-share-link-tokens-are-stored-in-clear.md), na rozdíl od všech ostatních tajemství serveru.
6. [Záznamy a bajty stojí za dvěma asynchronními rozhraními](0006-records-and-bytes-sit-behind-two-async-interfaces.md), takže si nasazení vybírá databázi i úložiště blobů.
7. [Funkce je modul z rout, služby a presenterů](0007-a-feature-is-a-module-of-routes-a-service-and-presenters.md) a routy nikdy nesahají na Store.
