# Metadata příloh jsou JSON sloupec v poznámce; vlastní tabulku dostává jen vlastnictví blobů

ADR 0017 (frontend) ukládá metadata přílohy do revize poznámky: přicházejí s poznámkou, odcházejí s ní a na serveru nemají vlastní život.
Rozhodnuto 2026-09-28: server tato metadata ukládá jako jeden JSON sloupec v `notes` a nikdy je nerozbaluje a malá tabulka `blobs` (id, účet, velikost, MIME typ, čas vytvoření) odpovídá na jediné otázky, které server o bajtech klade, totiž zda id existuje a komu patří, aniž by sahal na disk.
Tabulka `attachments` byla zamítnuta jako join, který by server udržoval při každé přijaté poznámce a nečetl by ho při žádné; frontend si vlastní tabulku drží, protože se na ni opravdu dotazuje.
