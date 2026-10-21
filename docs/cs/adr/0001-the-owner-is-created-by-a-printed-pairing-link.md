# Vlastníka vytvoří párovací odkaz vypsaný při prvním spuštění a tytéž jednorázové kódy párují zařízení a nesou pozvánky

ADR 0018 ve frontendovém repozitáři určovalo, že vlastníka vytvoří první návštěva čerstvého serveru.
V LAN je to souběh, který vyhraje kdokoli, kdo se k adrese dostane jako první, a telefon se navíc musí připojit zadáním hesla.
Rozhodnuto 2026-09-28: při prvním spuštění server vypíše do logu párovací odkaz (prostou URL a ASCII QR kód); jeho otevření vytvoří vlastníka a přihlásí toto zařízení a žádná jiná cesta vlastníka vytvořit nemůže.
Tentýž mechanismus, tabulka hašovaných jednorázových kódů s druhem (`setup`, `device`, `invite`), desetiminutovou platností a jediným použitím, slouží i dalším dvěma okamžikům připojení: přihlášené zařízení ukáže odkaz, který přidá další zařízení k jeho účtu, a vlastník ukáže odkaz, který nese pozvánku.
PWA vykreslí QR kód z URL; server kódy jen vydává a přijímá je místo hesla.
Zvažováno a zamítnuto: JSON Web Tokeny, protože bezstavový token nedokáže ukončit přístup jednoho zařízení bez denylistu, a tím je tabulka relací, kterou tento návrh už má; a ponechání otevřené první návštěvy, protože souběh je skutečný a token stojí jeden vypsaný řádek.
Odkaz odstraňuje psaní, ne TLS: skenující telefon musí na origin dosáhnout a důvěřovat jeho certifikátu.
Jen kód `setup` nevyprší podle hodin: zanikne, když se použije nebo když se server restartuje, takže restart je způsob, jak si budoucí vlastník řekne o nový odkaz.
