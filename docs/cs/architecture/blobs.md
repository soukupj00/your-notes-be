# Bloby

Životní cyklus bajtů přílohy, od nahrání po úklid.
Kód je v `src/modules/blobs/` (routy a služba), `src/http/sendBlob.ts`, `src/infra/blobs/` (disk, S3, paměť) a úklid v `src/modules/housekeeping/`.
Rozhodnutí jsou ADR 0003 (metadata se vezou na poznámce, vlastní tabulku dostává jen vlastnictví) a frontendové ADR 0017 (bajty se pod daným id zapisují jen jednou).

## Dvě místa, jedno id

Tabulka `blobs` zaznamenává, který účet vlastní dané id, jeho velikost a MIME typ a to, že bajty existují; úložiště blobů drží bajty pod tímto id.
Metadata přílohy (název, druh, rozměry, `thumbnailId`) jsou JSON sloupec na poznámce a putují s revizí poznámky; server je nikdy nečte, kromě zjištění, na co poznámka odkazuje.
Id jsou klientská UUID, takže zařízení může nahrát bajty před odesláním poznámky i po něm.

## Nahrání

`PUT /api/blobs/:id` streamuje tělo rovnou do úložiště blobů; routa vyžaduje `Content-Length` a `Content-Type` a tělo nad `BLOB_LIMIT_BYTES` odmítne dřív, než ho začne číst.
Předčasná odpověď tělo nikdy nečte: u odmítnutého velkého těla se spojení zavře, malé se dočte a zahodí, aby šlo spojení znovu použít.

- Id jiného účtu: `404`, stejně neznámé jako při stahování.
- Záznam, jehož bajty existují: `204` bez čtení těla; nahrání je idempotentní, takže opakovaný pokus po přerušeném spojení nic nestojí.
- Záznam, jehož bajty chybí: nahrání se přijme znovu, a tak se ztracený soubor zahojí.
- Jinak: nejdřív bajty, pak záznam, `201`.

Úložiště blobů uloží přesně `size` bajtů, nebo nic: na disku bajty skončí v `.tmp` a po ověření velikosti se přejmenují na své místo, takže čtenář nikdy neuvidí částečný soubor; na S3 se nahrávání při kratším nebo delším těle přeruší.
Pořadí bajty před záznamem znamená, že pád mezi oběma kroky zanechá soubor bez záznamu, který úklid odstraní; opačné pořadí by zanechalo záznam ručící za bajty, které neexistují.

## Stahování

`GET` a `HEAD /api/blobs/:id` odpovídají jen účtu, který dané id vlastní; id jiného účtu je stejně neznámé jako id, které neexistuje (`404`).
Bajty jsou pod daným id neměnné, takže id je `ETag`, odpověď je cacheovatelná na rok a `If-None-Match` odpoví `304`.
Každá odpověď s blobem nese `Content-Security-Policy: default-src 'none'; sandbox`, takže nahrané bajty se nikdy nespustí jako stránka tohoto originu, ať mají jakýkoli typ.
Záznam, jehož bajty zmizely, odpoví na `HEAD` i `GET` stavem `404`, i při shodném `If-None-Match`, bez cachovacích hlaviček, a zapíše chybu do logu.
Zařízení pak nahraje bajty znovu a další `PUT` je přijme, jak popisuje část „Nahrání“.

Odkaz pro sdílení čte přes `/api/public/shares/:token/blobs/:id` přílohy sdílené poznámky a jejich miniatury, nic jiného.

## Úklid

Denní úklid (`HousekeepingService`) uvolňuje bajty ve dvou krocích:

1. Každý blob zaznamenaný před více než dnem, který žádná poznámka jeho účtu neuvádí jako přílohu ani miniaturu, přijde nejdřív o záznam a pak o bajty.
   Den odkladu pokrývá nahrání, které dorazí dřív než jeho poznámka.
   Stejnou cestou odcházejí i bajty trvale smazané poznámky, jakmile její řádek nahradí tombstone (záznam o smazání).
   Pád mezi oběma smazáními zanechá soubor bez záznamu, který odstraní krok 2; opačné pořadí by zanechalo záznam ručící za bajty, které neexistují.
2. Soubor v úložišti blobů bez záznamu se smaže, když ho bez záznamu viděl už předchozí úklid: co zanechal pád, nebo co zanechal krok 1, když selhal mezi oběma smazáními.
   Soubor, který je bez záznamu viděn poprvé, si úklid jen zapamatuje, protože nahrávání mohlo zapsat bajty a ještě ne záznam.
   Tato paměť žije v procesu, takže server restartovaný každý den by soubor nikdy neviděl dvakrát.
   Úklid při startu proto takový soubor smaže hned při prvním pohledu: běží dřív, než server začne naslouchat, a pod zámkem instance, takže žádné nahrávání nemůže probíhat.

Soubory se vypíšou dřív, než se načtou záznamy, takže nahrávání, které mezitím skončí, je vidět i se svým záznamem.
Na S3 úložiště blobů vypisuje jen pod `S3_PREFIX` (výchozí `younotes/`), takže úklid nikdy nesáhne na zbytek sdíleného bucketu.
Záloha serveru vypisuje bajty podle záznamů; záznam, jehož bajty zmizely, se zkopíruje bez nich, s varováním.
