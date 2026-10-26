# Nastavení YourNotes doma

Tento návod vás provede od úplného začátku až k poznámkám, které se synchronizují mezi telefonem a notebookem.
Nemusíte být programátor.
Každý příkaz opište přesně tak, jak je napsaný; řádky začínající `#` uvnitř rámečku s příkazy jsou vysvětlivky, ne příkazy.

## 1. Co nastavujete

Na jednom počítači u vás doma poběží server YourNotes.
Telefony a notebooky ho otevřou ve webovém prohlížeči a nainstalují si ho jako aplikaci.
Vaše poznámky jsou uložené na tomto jednom počítači a každé zařízení, na kterém se přihlásíte, si drží jejich kopii, která funguje i offline.
Nic se neposílá na cizí počítače.
Jste vlastník: máte první účet a jako jediný můžete zvát další lidi.

## 2. Než začnete

Budete potřebovat:

- Počítač, který zůstává zapnutý: Raspberry Pi, starý notebook, domácí server nebo NAS.
  Měl by na něm běžet Linux; běží na většině NAS a na každém Raspberry Pi.
- Na tomto počítači Docker.
  Docker je program, který spouští server v uzavřené krabičce, takže se nic jiného v počítači nezmění.
  Nainstalujte ho podle návodu přímo od Dockeru: <https://docs.docker.com/engine/install/>.
  Pak postupujte podle části „Manage Docker as a non-root user“ na <https://docs.docker.com/engine/install/linux-postinstall/>, aby příkazy níže fungovaly bez `sudo`.
- Asi deset minut.

Příkazy budete psát do terminálu na tomto počítači, nebo přes SSH z jiného počítače.
Jestli je Docker připravený, ověříte tímto příkazem:

```bash
docker compose version
```

Měl by vypsat `Docker Compose version` a za tím číslo.
Pokud vypíše `docker: 'compose' is not a docker command`, projděte znovu instalační stránku Dockeru výše; nainstaluje i Compose.

## 3. Vyberte, jak se k serveru dostanou vaše zařízení

Prohlížeče dovolí aplikaci fungovat offline a používat mikrofon a fotoaparát jen tehdy, když je adresa zabezpečená (začíná `https://` a má důvěryhodný certifikát).
První volba je proto, jak vaše zařízení k takové zabezpečené adrese přijdou.
Vyberte si jeden ze tří způsobů níže a zapamatujte si jeho dvě nastavení; zadáte je v části 4.

| Způsob | Funguje i mimo domov | Další aplikace na každém zařízení | Změny v routeru | Certifikát k instalaci na každé zařízení |
|---|---|---|---|---|
| 3a. Tailscale (doporučeno) | Ano | Tailscale | Ne | Ne |
| 3b. Vlastní doména | Ano | Ne | Ano | Ne |
| 3c. Jen doma | Ne, jen na domácí Wi-Fi | Ne | Jedna drobná | Ano |

Pokud si nejste jistí, zvolte Tailscale.
„Jen doma“ zvolte, pokud nechcete instalovat nic navíc a YourNotes budete používat jen doma.

### 3a. Tailscale (doporučeno)

Tailscale je bezplatná soukromá síť mezi vašimi vlastními zařízeními.
Dá počítači jméno jako `homebox.tail1234.ts.net` se skutečným certifikátem, funguje i mimo domov a nevyžaduje žádné změny v routeru.

1. Nainstalujte Tailscale na počítač a na každý telefon a notebook, na kterém budete YourNotes používat: <https://tailscale.com/download>.
   Všude se přihlaste stejným účtem.
   Na telefonu otevřete aplikaci Tailscale a zapněte ji; měla by ukazovat „Connected“.
   Nechte ji zapnutou vždy, když chcete, aby se poznámky synchronizovaly.
2. Otevřete stránku DNS v administraci Tailscale: <https://login.tailscale.com/admin/dns>.
   Zapněte **MagicDNS** a potom **HTTPS Certificates**.
3. Otevřete stránku Machines: <https://login.tailscale.com/admin/machines>.
   Klikněte na svůj počítač; jeho celé jméno končí na `.ts.net`, například `homebox.tail1234.ts.net`.

Vaše dvě nastavení:

```bash
YOURNOTES_HOST=homebox.tail1234.ts.net
YOURNOTES_TLS=auto
```

Použijte jméno svého počítače, ne to z příkladu.
V souboru `compose.yml` je potřeba ještě jedna změna, ukážeme ji v části 4.

### 3b. Vlastní doména

Tuto možnost použijte, pokud vlastníte doménu, například `example.com`, a chcete mít YourNotes dostupné odkudkoli z internetu.
Router přitom musí pustit internet dovnitř, a proto to není doporučená cesta.

1. U poskytovatele domény přidejte záznam `A` pro jméno jako `notes.example.com`, který ukazuje na veřejnou IP adresu vaší domácnosti (zjistíte ji na <https://ifconfig.me>).
2. V routeru přesměrujte porty `80` a `443` na místní adresu počítače.
   V návodu k routeru se tomu říká „přesměrování portů“ (port forwarding).

Vaše dvě nastavení:

```bash
YOURNOTES_HOST=notes.example.com
YOURNOTES_TLS=auto
```

### 3c. Jen doma, bez internetu

Tuto možnost použijte, pokud počítač nemá být nikdy dostupný zvenku vaší domácí sítě.
Zařízení se synchronizují, jen když jsou na stejné Wi-Fi jako počítač; mimo domov dál fungují offline a změny doženou, až budou zpátky.
Server si vytvoří vlastní certifikát a každému zařízení je potřeba jednou říct, že mu má důvěřovat; to uděláte v části 4.

1. Zjistěte místní adresu počítače:

   ```bash
   hostname -I
   ```

   Vypíše jednu nebo více adres oddělených mezerami, například `192.168.1.50 172.17.0.1`.
   Použijte tu, která začíná `192.168.` nebo `10.`.
   Adresy začínající `172.` (patří Dockeru) nebo `100.` (patří Tailscale) si nevšímejte.
2. V routeru tuto adresu počítači vyhraďte, aby se nikdy nezměnila.
   Routery tomu říkají „DHCP rezervace“ nebo „statické přidělení“ (static lease); kde to najdete, ukáže návod k routeru.
   Bez toho se adresa může po restartu změnit a zařízení server ztratí.

Vaše dvě nastavení, s vaší vlastní adresou:

```bash
YOURNOTES_HOST=192.168.1.50
YOURNOTES_TLS=internal
```

## 4. Spuštění

Vytvořte pro YourNotes složku a stáhněte do ní tři soubory:

```bash
mkdir yournotes
cd yournotes
curl -fsSLO https://raw.githubusercontent.com/soukupj00/your-notes-be/v0.1.0/compose.yml
curl -fsSLO https://raw.githubusercontent.com/soukupj00/your-notes-be/v0.1.0/Caddyfile
curl -fsSLO https://raw.githubusercontent.com/soukupj00/your-notes-be/v0.1.0/.env.example
```

Ze vzorového souboru si vytvořte vlastní soubor s nastavením a otevřete ho v textovém editoru:

```bash
cp .env.example .env
nano .env
```

Řádky `YOURNOTES_HOST` a `YOURNOTES_TLS` změňte na dvě nastavení z části 3.
Všechno ostatní nechte, jak je.
Uložte klávesami `Ctrl+O` a `Enter`, pak editor zavřete klávesami `Ctrl+X`.

**Jen pro Tailscale**: stejným způsobem otevřete `compose.yml` (`nano compose.yml`) a zhruba uprostřed najděte tento řádek:

```yaml
      # - /var/run/tailscale/tailscaled.sock:/var/run/tailscale/tailscaled.sock
```

Smažte `# ` na jeho začátku, mezery před ním ponechte, takže bude vypadat takto:

```yaml
      - /var/run/tailscale/tailscaled.sock:/var/run/tailscale/tailscaled.sock
```

Spusťte YourNotes:

```bash
docker compose up -d
```

První spuštění stáhne server a trvá minutu nebo dvě.
Potom si zobrazte zprávy serveru:

```bash
docker compose logs yournotes
```

Blízko konce uvidíte „No Owner yet“, odkaz a velký čtvercový QR kód.
Odkaz vypadá jako `https://homebox.tail1234.ts.net/pair#…` s dlouhým kódem na konci.
Zkontrolujte, že je v něm adresa, kterou jste zvolili v části 3.
Pokud je v něm `localhost` nebo něco jiného, není v `.env` správně nastavené `YOURNOTES_HOST`: opravte ho a znovu spusťte `docker compose up -d`.

<!-- screenshot: the server log showing "No Owner yet", the Pairing Link and the QR code -->

Tento odkaz vytvoří váš účet, proto s ním zacházejte jako s klíčem.
Funguje jen jednou.
Restart serveru vytvoří nový odkaz a starý přestane fungovat; dokud nastavení nedokončíte, nový odkaz kdykoli získáte těmito příkazy:

```bash
docker compose restart yournotes
docker compose logs yournotes
```

### Jen doma (3c): důvěra v certifikát

Pokud používáte Tailscale nebo vlastní doménu, tuto část přeskočte.

Při nastavení jen doma musí každé zařízení jednou začít důvěřovat certifikátu serveru, ještě než na něm YourNotes otevřete.
Jinak prohlížeč ukáže varování, že připojení není soukromé, a aplikace nebude fungovat offline.

Ve složce `yournotes` zkopírujte certifikát ze serveru:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./yournotes-root.crt
```

Soubor `yournotes-root.crt` pošlete na každé zařízení, například e-mailem sami sobě, a pak:

- **iPhone nebo iPad**: otevřete soubor v Safari nebo v Mailu a povolte stažení.
  Jděte do Nastavení, Obecné, Správa VPN a zařízení, klepněte na profil, jehož název začíná „Caddy Local Authority“, a klepněte na Instalovat.
  Pak jděte do Nastavení, Obecné, Informace, Nastavení důvěryhodnosti certifikátů a certifikát tam zapněte.
  Potřeba jsou obě části; na tu druhou se snadno zapomene.
- **Android**: jděte do Nastavení, Zabezpečení, Šifrování a pověření, Instalovat certifikát, Certifikát CA a vyberte soubor.
  Názvy nabídek se u různých výrobců telefonů trochu liší; v Nastavení vyhledejte „certifikát“.
- **Windows**: dvakrát klikněte na soubor, klikněte na Nainstalovat certifikát, zvolte Místní počítač, pak „Všechny certifikáty umístit v následujícím úložišti“, Procházet, Důvěryhodné kořenové certifikační autority.
- **Mac**: dvojklikem soubor přidáte do Klíčenky, tam na certifikát dvakrát klikněte, otevřete Důvěra a u „Při použití tohoto certifikátu“ nastavte Vždy důvěřovat.
- **Firefox na jakémkoli počítači** má vlastní seznam: otevřete Nastavení, vyhledejte „certifikáty“, klikněte na Zobrazit certifikáty, otevřete Autority, klikněte na Importovat, vyberte soubor a zaškrtněte „Důvěřovat této certifikační autoritě při identifikaci webových serverů“.

Potom prohlížeč zavřete a znovu otevřete.
Jestli to zabralo, ověříte tak, že otevřete `https://` a za tím vaši adresu, například `https://192.168.1.50`: stránka by se měla otevřít bez varování.

## 5. Vytvoření vlastníka

Vyberte zařízení, na kterém chcete YourNotes používat jako první, například svůj telefon.

1. S Tailscale zkontrolujte, že je na něm aplikace Tailscale zapnutá.
   Při nastavení jen doma zkontrolujte, že je připojené k domácí Wi-Fi.
2. Naskenujte jeho fotoaparátem QR kód z části 4, nebo do jeho prohlížeče přesně opište odkaz, včetně všeho za `#`.
3. Otevře se stránka „Vytvořit vlastníka“.
   Zvolte si uživatelské jméno a heslo a klepněte na „Vytvořit vlastníka“.
4. Teď jste vlastník a toto zařízení je přihlášené.

<!-- screenshot: the "Create the Owner" page on a phone -->

Heslo si zapište na bezpečné místo.
Nová zařízení se obvykle připojují naskenováním odkazu ze zařízení, které už je přihlášené, takže ho budete zadávat jen zřídka.
Když ale nezbude žádné přihlášené zařízení, které by odkaz ukázalo, například po ztrátě jediného telefonu, dostanete se dovnitř právě heslem.

Tento první odkaz je teď spotřebovaný.
Když ho otevřete na druhém zařízení, ukáže se jen „Platnost tohoto odkazu vypršela, nebo už byl použit“; všechna další zařízení přidejte podle části 6.

Pokud chcete YourNotes nainstalovat jako aplikaci, otevřete nabídku prohlížeče a zvolte „Přidat na plochu“ (telefony) nebo „Nainstalovat“ (notebooky).
Instalujte ji vždy z adresy serveru, jak je popsáno výše.
Aplikace se synchronizuje se serverem, ze kterého byla otevřena, takže kopie nainstalovaná odjinud se k vašemu serveru nikdy nedostane.

## 6. Přidání dalších zařízení

Tento postup zopakujte pro každý telefon, tablet nebo notebook, který chcete synchronizovat.

1. Na zařízení, které už je přihlášené, otevřete Nastavení ikonou ozubeného kola nahoře, klepněte nahoře na svůj účet a v části Zařízení klepněte na „Přidat zařízení“.
   Pokud je aplikace v angličtině, jde o „Settings“, „Devices“ a „Add a Device“.
   Zobrazí se párovací odkaz jako QR kód.
2. Na novém zařízení zkontrolujte, že se dostane k serveru: Tailscale je zapnutý, nebo je zařízení na domácí Wi-Fi.
   Při nastavení jen doma (3c) na něm nejdřív nastavte důvěru v certifikát.
3. Naskenujte QR kód fotoaparátem nového zařízení.
   Notebook nemá čím skenovat: klepněte místo toho na „Kopírovat odkaz“, pošlete odkaz do notebooku, například e-mailem sami sobě, a otevřete ho v prohlížeči notebooku.
4. Otevře se stránka „Přidat toto zařízení“; klepněte na „Přihlásit se“.
   Zařízení se přihlásí k vašemu účtu bez zadávání hesla a začnou na něj přicházet vaše poznámky.
5. Nainstalujte YourNotes jako aplikaci, stejně jako v části 5.

<!-- screenshot: Settings, Account, Devices with the "Add a Device" button -->
<!-- screenshot: the Pairing Link QR code shown by "Add a Device" -->
<!-- screenshot: the "Add this Device" page on the new phone -->

Odkaz funguje jednou a deset minut.
Pokud vypršel, klepněte znovu na „Přidat zařízení“ a dostanete nový.

Jestli synchronizace funguje, ověříte tak, že na jednom zařízení napíšete poznámku a pár sekund počkáte: objeví se na druhém.

Každé zařízení se zobrazí v Nastavení, Účet, v části Zařízení.
Když některé ztratíte, odeberte ho tam; odhlásí se a nic jiného se nezmění.

## 7. Přidání člena domácnosti

1. Jako vlastník otevřete Nastavení („Settings“), klepněte nahoře na svůj účet a v části Členové („Members“) klepněte na „Pozvat člena“ („Invite a member“).
   Zobrazí se QR kód.
2. Druhý člověk se ujistí, že se jeho telefon dostane k serveru, stejně jako v části 6.
   S Tailscale to znamená, že mu počítač v Tailscale nasdílíte, nebo se přihlásí ke stejnému účtu Tailscale.
3. Naskenuje QR kód, uvidí stránku „Připojit se“, zvolí si vlastní uživatelské jméno a heslo a klepne na „Vytvořit můj účet“.

Jeho poznámky jsou oddělené od vašich: nikdo z vás nevidí poznámky toho druhého.
Pozvánka funguje jednou a deset minut.

## 8. Zálohování a obnova

Všechno, co YourNotes ví, je uložené uvnitř Dockeru, v místě, kterému se říká svazek (volume).
Záloha ho zkopíruje do složky `backups` vedle vašeho nastavení, odkud ji můžete přenést na USB disk nebo jiný počítač.

Poprvé ve složce `yournotes` tuto složku vytvořte a předejte ji účtu číslo 1000, pod kterým YourNotes uvnitř Dockeru běží:

```bash
mkdir -p backups && sudo chown 1000:1000 backups
```

Teď vytvořte zálohu:

```bash
docker compose run -T --rm -v ./backups:/backups yournotes node dist/cli.js backup /backups/$(date +%F)
```

Vytvoří se složka pojmenovaná podle dnešního data, například `backups/2026-09-28`, a vypíše se „Backed up“ s počtem zkopírovaných záznamů každého druhu.
Zálohovat můžete klidně i ve chvíli, kdy se YourNotes používá.
Stejně to funguje i se záznamy v PostgreSQL nebo s přílohami v S3 bucketu ([stránka o úložištích](setup-backends.md)): složka obsahuje obojí.
Druhá záloha ve stejný den potřebuje jiný název, například `/backups/$(date +%F)-evening`.
Pokud se záloha zastaví v polovině, v její složce chybí `manifest.json`; složku smažte a příkaz spusťte znovu.

Zálohu smí číst jen tento účet, protože obsahuje úplně všechno, včetně odkazů pro sdílení.
Na většině počítačů je to váš vlastní účet; pokud ne, kopírování nebo mazání zálohy vyžaduje `sudo`:

```bash
sudo rm -r backups/2026-09-28
```

Chcete-li zálohovat každou noc ve 3:00, otevřete seznam plánovaných úloh:

```bash
crontab -e
```

Na konec přidejte tento řádek a `/home/you/yournotes` v něm nahraďte svou složkou (vypíše ji příkaz `pwd`):

```bash
0 3 * * * cd /home/you/yournotes && docker compose run -T --rm -v ./backups:/backups yournotes node dist/cli.js backup /backups/$(date +\%F)
```

`\%` je tam záměrně: plánovač ho potřebuje.
Staré zálohy se samy nemažou; čas od času je smažte.

Zálohu obnovíte takto; nahradí všechno, co je na serveru:

```bash
docker compose down
docker compose run --rm -v ./backups/2026-09-28:/backup:ro yournotes sh -c 'rm -rf /data/* && node dist/cli.js restore /backup'
docker compose up -d
```

Použijte datum zálohy, kterou chcete obnovit.
Druhý řádek vyprázdní data serveru, nahraje do nich zálohu a vypíše „Restored“.
První řádek nevynechávejte: druhý vyprázdní data i tehdy, když YourNotes běží, dřív než to obnova stihne poznat.
Pokud je záloha poškozená nebo neúplná, obnova to oznámí a nenahraje z ní nic; obnovte místo ní starší zálohu.
Všechno, co se zapsalo po této záloze, ze serveru zmizí.
Zařízení, která se synchronizovala po této záloze, při příští synchronizaci stáhnou všechno znovu.
Zařízení přidaná po této záloze se odhlásí a je potřeba je přidat znovu, jak ukazuje část 6.
Obnova je pro případ, kdy se data počítače ztratí nebo poškodí, ne pro vrácení jedné změny.

Obnova naplní jen prázdný server, takže pokud používáte PostgreSQL nebo S3 bucket, vyprázdněte před druhým řádkem i je:

- Pro PostgreSQL z `compose.yml` spusťte po `docker compose down` příkaz `docker volume rm yournotes_postgres-data`; druhý řádek ho znovu spustí, prázdný.
- Pro bucket SeaweedFS z `compose.yml` (část 1 [stránky o úložištích](setup-backends.md#1-prilohy-v-s3-bucketu)) spusťte po `docker compose down` příkaz `docker volume rm yournotes_s3-data` a pak `docker compose up -d s3`, který bucket vytvoří znovu, prázdný; druhý řádek ho nespouští.
- U vlastního serveru PostgreSQL databázi smažte a vytvořte znovu, prázdnou.
- Vlastní bucket vyprázdněte nástroji svého poskytovatele.

Složku zálohy se souborem `younotes.db` a bez `manifest.json` vytvořila starší verze YourNotes.
Obnova ji neumí přečíst; vraťte ji zkopírováním souborů pod názvem, který používá tato verze:

```bash
docker compose down
docker compose run --rm --user root -v ./backups/2026-09-28:/backup:ro yournotes sh -c 'rm -rf /data/* && cp -a /backup/. /data/ && for f in /data/younotes.db*; do mv "$f" "/data/yournotes${f#/data/younotes}"; done && chown -R node:node /data'
docker compose up -d
```

## 9. Aktualizace

Každé vydání má číslo verze, například `v0.2.0`.
Ke starší verzi se nedá vrátit jinak než obnovou zálohy, takže každá aktualizace začíná zálohou.

1. Vytvořte zálohu podle části 8, ještě než cokoli změníte.
   Ne až po úpravě `.env`: příkaz pro zálohu spouští verzi uvedenou v `.env` a novější verze by aktualizovala data pod stále běžícím serverem, takže by záloha obsahovala už nové uspořádání dat.
2. Otevřete nastavení (`nano .env`), změňte řádek `YOURNOTES_VERSION` na nové číslo a uložte.
3. Spusťte:

   ```bash
   docker compose pull
   docker compose up -d
   ```

Server si při spuštění aktualizuje data sám.
Pro návrat nastavte `YOURNOTES_VERSION` zpět na staré číslo a obnovte zálohu podle části 8.

## 10. Zapomenuté heslo vlastníka

Ve složce `yournotes` spusťte:

```bash
docker compose exec yournotes node dist/cli.js reset-owner-password
```

Příkaz jednou vypíše nové heslo.
Přihlaste se jím a pak si ho zapište.
Zařízení, která už jsou přihlášená, zůstanou přihlášená.
Člen domácnosti, který zapomněl heslo, požádá vlastníka; ten otevře Nastavení, Účet, Členové, u jeho jména klepne na „Nastavit nové heslo“ a nové heslo mu sdělí.

## 11. Vaše data: kdo co vidí

| Jak jste server nastavili | Kdo se k serveru dostane | Kdo může číst vaše poznámky |
|---|---|---|
| 3a. Tailscale | Jen zařízení přihlášená k vašemu účtu Tailscale a kdokoli, komu počítač v Tailscale nasdílíte | Vy na svých zařízeních a ten, kdo server provozuje |
| 3b. Vlastní doména | Přihlašovací stránku otevře kdokoli na internetu | Vy na svých zařízeních, ten, kdo server provozuje, a kdokoli s odkazem pro sdílení na některou z vašich poznámek |
| 3c. Jen doma | Kdokoli ve vaší domácí síti | Vy na svých zařízeních a ten, kdo server provozuje |

Několik věcí na rovinu:

- Kdo server provozuje, může číst databázi a s ní každou poznámku každého účtu na serveru.
  V domácnosti jste to obvykle vy; podle toho volte, kdo ho bude provozovat.
- Poznámky nejsou šifrované end-to-end: server je ukládá tak, jak jsou.
- Poznámky člena domácnosti jsou v aplikaci oddělené od vašich, ale ne před tím, kdo server provozuje.
- Odkaz pro sdílení, tedy odkaz jen pro čtení na jednu poznámku, se otevře každému, kdo se dostane k serveru, ať je přihlášený, nebo ne.
  S vlastní doménou (3b) je to celý internet.
- Zálohy jsou úplné kopie; chraňte je stejně pečlivě jako samotný počítač.
- Pokud ukládáte přílohy do S3 bucketu (část 1 [stránky o úložištích](setup-backends.md#1-prilohy-v-s3-bucketu)), má je i poskytovatel úložiště a může je číst.
- Pokud ukládáte záznamy na server PostgreSQL, který provozuje někdo jiný (část 2 [stránky o úložištích](setup-backends.md#2-zaznamy-v-postgresql)), může vaše poznámky číst i on.

## 12. Když něco nefunguje

**Prohlížeč varuje, že připojení není soukromé.**
Při nastavení jen doma (3c) toto zařízení ještě nedůvěřuje certifikátu; zopakujte pro něj kroky z 3c a na iPhonu zkontrolujte, že je zapnutý přepínač v Nastavení důvěryhodnosti certifikátů.
S Tailscale zkontrolujte, že je v administraci zapnuté HTTPS Certificates a že jste v `compose.yml` odstranili `# `; co se pokazilo, ukáže `docker compose logs caddy`.

**Odkaz z QR kódu se neotevře, nebo aplikace hlásí „Server se nepodařilo zastihnout“.**
Zařízení se k serveru nedostane: s Tailscale zkontrolujte, že je aplikace Tailscale zapnutá a ukazuje „Connected“; doma zkontrolujte, že je zařízení na domácí Wi-Fi, a ne na mobilních datech.

**Stránka hlásí „Platnost tohoto odkazu vypršela, nebo už byl použit“.**
Každý odkaz funguje jen jednou.
Pokud jste už vlastníka vytvořili na jiném zařízení, je to v pořádku: přidejte toto zařízení z některého přihlášeného (část 6).
Odkaz z „Přidat zařízení“ nebo „Pozvat člena“ navíc po deseti minutách vyprší; klepněte na tlačítko znovu a dostanete nový.
Pokud vlastníka ještě nikdo nevytvořil, spusťte `docker compose restart yournotes` a použijte nový odkaz z `docker compose logs yournotes`.

**Stránka hlásí „Tento odkaz je neúplný“.**
Dlouhý kód za `#` se uřízl, což se stane, když se odkaz opisuje ručně nebo se zkopíruje jen zčásti.
Naskenujte raději QR kód, nebo zkopírujte celý odkaz.

**Poznámky se na druhém zařízení neobjevují.**
Zkontrolujte, že jsou obě zařízení uvedená v Nastavení, Účet, v části Zařízení a že se obě dostanou k serveru.
Zkontrolujte, že aplikace byla na obou otevřena ze stejné adresy (část 5): kopie nainstalovaná z jiné adresy se nesynchronizuje s ničím.
Synchronizace probíhá na pozadí; když přepnete do jiné aplikace a zpět, zkusí to hned znovu.

**`docker compose up -d` hlásí „address already in use“.**
Port 80 nebo 443 už na počítači používá jiný program, obvykle jiný webový server.
Který to je, zjistíte takto:

```bash
sudo ss -ltnp | grep -E ':(80|443) '
```

Ten program zastavte, nebo YourNotes spusťte na jiném počítači.

**Log hlásí „No Owner yet“, přestože jste nastavení už dokončili.**
Log uchovává i zprávy z dřívějších spuštění; dívejte se jen na nejnovější řádky:

```bash
docker compose logs --tail 40 yournotes
```

Pokud i nejnovější spuštění hlásí „No Owner yet“, server startuje s prázdnými daty.
To se stane po `docker compose down -v`: `-v` smaže všechna uložená data, proto ho nikdy nepřidávejte.
Poznámky získáte zpět obnovou zálohy (část 8).

## 13. Volitelně: PostgreSQL, S3 bucket nebo přechod mezi nimi

Ve výchozím stavu YourNotes ukládá záznamy i přílohy přímo na počítači, a to je správná volba téměř pro každou domácnost.
Chcete-li přílohy ukládat do S3 bucketu, záznamy do PostgreSQL nebo na jedno z nich převést běžící server, postupujte podle stránky [YourNotes s PostgreSQL nebo S3 bucketem](setup-backends.md).
