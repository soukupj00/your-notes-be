# Proud změn se čte přímo z řádků, ne z logu změn

Proud změn (change feed), který si zařízení stahuje, odpovídá na jedinou otázku, „co se v tomto účtu změnilo od pořadového čísla (Sequence) N“, a čtenář by mohl čekat, že na ni odpovídá append-only tabulka `changes`.
Rozhodnuto 2026-09-28: každý synchronizovaný řádek (`notes`, `tags`, `note_tags`, `tombstones`) nese pořadové číslo, pod kterým byl naposledy přijat, indexované spolu s účtem, a čítač pořadových čísel je sloupec v `accounts`, který se posouvá uvnitř transakce push; stránka proudu jsou tyto řádky s pořadovým číslem nad kurzorem, seřazené a omezené počtem.
Samostatný log byl zamítnut, protože je druhou kopií téhož faktu, kterou pád mezi dvěma zápisy může nechat v rozporu s řádky, a protože produkt neuchovává historii: deset přijatých změn jedné poznámky dluží proudu jeden řádek, což přesně dává sloupec a k čemu by log musel teprve kompaktací dospět.
Důsledek: stránka se skládá ze čtyř tabulek v jedné čtecí transakci, což v měřítku domácnosti stačí, a kdyby jednou nestačilo, je to strop, ke kterému se vrátit.
