# Tokeny odkazů pro sdílení se ukládají v čitelné podobě, na rozdíl od všech ostatních tajemství serveru

Relace a párovací kódy se ukládají jen jako haše SHA-256, takže uniklá databáze nikoho nepřihlásí.
Rozhodnuto 2026-09-28: token odkazu pro sdílení se ukládá tak, jak je, protože člověk, který poznámku sdílel, musí mít možnost tentýž odkaz později znovu zkopírovat, a z haše se odkaz zpět získat nedá.
Hašování by tu nic nechránilo: odkaz pro sdílení zpřístupní jen jednu poznámku jen pro čtení a kdo má databázi, má už všechny poznámky v ní.
Zvažováno a zamítnuto: hašování a zobrazení odkazu jen jednou, kvůli čemuž by „zkopírovat odkaz znovu“ vydalo nový token a potichu rozbilo všechny už odeslané kopie.
Sdílení se odvolá jeho smazáním a jedna poznámka má nejvýše jedno sdílení, takže odvolání je jednoznačné.
