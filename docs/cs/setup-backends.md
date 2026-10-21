# YourNotes s PostgreSQL nebo S3 bucketem

Tato stránka navazuje na [návod k nastavení](setup.md) a je pro těch pár domácností, které chtějí mít záznamy nebo přílohy jinde než přímo na počítači.
Většina domácností nic z toho nepotřebuje: ve výchozím stavu YourNotes uchovává vše na počítači.
Všechny příkazy spouštějte ze složky `yournotes`, stejně jako v návodu.

## 1. Přílohy v S3 bucketu

Přílohy jsou fotky, nahrávky a soubory, které k poznámkám přidáte.
Normálně je server uchovává na počítači, vedle vašich poznámek.
Pokud má počítač malý disk, může je místo toho ukládat do S3 bucketu: online úložiště, které nabízí řada poskytovatelů, například Amazon S3, Backblaze B2 nebo Cloudflare R2.
Samotné poznámky zůstanou na počítači, ale přílohy pak budou na počítačích poskytovatele a poskytovatel je může číst.
Většina domácností to nepotřebuje; pokud vy ne, tuto část přeskočte.

Rozhodněte se při prvním nastavení, nebo přílohy běžícího serveru přesuňte do bucketu, jak ukazuje část 3.
Pouhá změna nastavení by přílohy, které už máte, učinila nedostupnými.

U poskytovatele:

1. Vytvořte bucket, například `yournotes`, a ponechte ho soukromý: nikdy nezapínejte veřejný přístup.
   Server každou přílohu vydává sám, a právě díky tomu fungují odkazy pro sdílení i bezpečnostní kontroly příloh.
2. Server ukládá své soubory do složky `yournotes/` v bucketu a pravidelně z této složky odstraňuje vše, o čem neví.
   Zbytku bucketu se nikdy nedotkne.
3. Vytvořte přístupový klíč, který smí v tomto bucketu vypisovat, číst, zapisovat a mazat.
   Poskytovatel zobrazí ID klíče a tajný klíč; tajný klíč se často zobrazí jen jednou, takže si ho hned zkopírujte.
4. Pokud to poskytovatel nabízí, zapněte pro bucket verzování.
   Verzování uchovává dřívější kopie každého souboru, takže smazanou přílohu lze vrátit i mezi dvěma zálohami.
   Záloha z [části 8 návodu k nastavení](setup.md#8-zalohovani-a-obnova) kopíruje i přílohy v bucketu.

Pak otevřete nastavení (`nano .env`) a přidejte tyto řádky s hodnotami od svého poskytovatele:

```bash
BLOB_STORE=s3
S3_ENDPOINT=https://s3.your-provider.example
S3_REGION=us-east-1
S3_BUCKET=yournotes
S3_ACCESS_KEY_ID=your-key-id
S3_SECRET_ACCESS_KEY=your-secret-key
```

`S3_ENDPOINT` je adresa S3 z pokynů vašeho poskytovatele; pro samotné Amazon S3 tento řádek vynechte.
`S3_REGION` je region, který poskytovatel u bucketu uvádí; pokud žádný neuvádí, ponechte `us-east-1`.
Někteří poskytovatelé potřebují také `S3_FORCE_PATH_STYLE=true`; jejich pokyny to uvádějí.
Chcete-li soubory ukládat do jiné složky bucketu, přidejte `S3_PREFIX=` s názvem složky a `/` na konci, například `S3_PREFIX=notes/`.
`S3_PREFIX=` bez ničeho za `=` znamená kořen bucketu a server pak celý bucket považuje za svůj.
Oba klíče otevírají váš bucket, proto chraňte `.env` stejně jako samotný počítač.

Bucket, který naplnila starší verze YourNotes, má soubory v kořeni, ne ve složce `yournotes/`.
Používejte ho dál s `S3_PREFIX=` bez ničeho za `=`, nebo soubory přesuňte do `yournotes/` příkazem `migrate`, jak ukazuje konec části 3.

Spusťte YourNotes znovu příkazem `docker compose up -d`.
Při každém spuštění server čeká až půl minuty na bucket, v `docker compose logs yournotes` hlásí „Waiting for S3 bucket“ a pak se zastaví s uvedením důvodu, například „no such bucket“.
Pokud poskytovatel klíče odmítne, server se zastaví okamžitě s hlášením „access denied“.
Hlášení uvádějí bucket a adresu, nikdy klíče.

Chcete-li si to vyzkoušet bez poskytovatele, soubor `compose.yml` umí spustit SeaweedFS, S3 bucket na stejném počítači.
Místo řádků výše přidejte do `.env` tyto, se dvěma klíči, které si vymyslíte, a to ještě před prvním spuštěním SeaweedFS, protože je převezme jako své přihlašovací údaje:

```bash
COMPOSE_PROFILES=s3
BLOB_STORE=s3
S3_ENDPOINT=http://s3:8333
S3_BUCKET=yournotes
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=make-up-a-key-id
S3_SECRET_ACCESS_KEY=make-up-a-long-secret
```

Pokud používáte i PostgreSQL z části 2, první řádek je `COMPOSE_PROFILES=postgres,s3`.
Pak spusťte `docker compose up -d`.
Nikdy nepřidávejte `--profile` k příkazu `docker compose`: nahrazuje `COMPOSE_PROFILES`, takže `--profile s3` by databázi z části 2 vynechalo.
Přílohy tak zůstávají na stejném počítači, takže je to jen na vyzkoušení.

## 2. Záznamy v PostgreSQL

Normálně server uchovává vaše poznámky, účty a zařízení v jednom souboru na počítači, a to je správná volba téměř pro každou domácnost.
Pokud už PostgreSQL databázi provozujete nebo chcete záznamy spravovat jejími vlastními nástroji, server je může ukládat tam.
Přílohy zůstanou, kde jsou: na počítači, nebo ve vašem S3 bucketu (část 1).

Rozhodněte se při prvním nastavení, nebo záznamy běžícího serveru přesuňte, jak ukazuje část 3.
Pouhá změna nastavení by způsobila, že server začne prázdný.

Chcete-li PostgreSQL provozovat na stejném počítači, otevřete nastavení (`nano .env`) a přidejte tyto řádky s heslem, které si vymyslíte z písmen, číslic a pomlček:

```bash
COMPOSE_PROFILES=postgres
POSTGRES_PASSWORD=make-up-a-long-password
DATABASE_URL=postgres://yournotes:make-up-a-long-password@postgres:5432/yournotes
```

Heslo se objevuje dvakrát a v obou řádcích musí být stejné.
První řádek zajistí, že každý příkaz `docker compose` zahrne i databázi; pokud používáte i SeaweedFS z části 1, je to `COMPOSE_PROFILES=postgres,s3`.
Spusťte YourNotes znovu příkazem `docker compose up -d`.

Chcete-li použít PostgreSQL server, který už provozujete, vytvořte na něm prázdnou databázi s uživatelem, který ji vlastní, a nastavte jen `DATABASE_URL` ve tvaru `postgres://user:password@address:5432/database`.
Tabulky si server při spuštění vytvoří sám.

Při každém spuštění server čeká až půl minuty na databázi, v `docker compose logs yournotes` hlásí „Waiting for PostgreSQL“ a pak se zastaví s uvedením důvodu, například špatného hesla.
Jeho hlášení uvádějí adresu databáze, nikdy heslo.

Jednu databázi smí používat jen jeden server YourNotes.
Druhý se okamžitě zastaví s hlášením „Another YourNotes server is already using PostgreSQL“.

Záloha z [části 8 návodu k nastavení](setup.md#8-zalohovani-a-obnova) funguje s PostgreSQL stejně.
Dalším způsobem, jak záznamy zálohovat, je vlastní nástroj PostgreSQL `pg_dump`, jak popisuje jeho dokumentace: <https://www.postgresql.org/docs/17/backup-dump.html>.

## 3. Přesun běžícího serveru do PostgreSQL nebo S3

Jakmile YourNotes uchovává vaše poznámky, jejich přesun je jediný příkaz, `migrate`, který vše zkopíruje na nové místo.
Každé zařízení zůstane přihlášené a synchronizuje dál, jako by se nic nestalo.
Stará kopie zůstane, kde byla, nepoužívaná, takže se můžete vrátit tím, že změny nastavení vrátíte zpět.

1. Vytvořte zálohu, jak ukazuje [část 8 návodu k nastavení](setup.md#8-zalohovani-a-obnova).
2. Připravte nové místo, ale nastavení serveru zatím neměňte: pro PostgreSQL z `compose.yml` přidejte do `.env` jen řádky `COMPOSE_PROFILES` a `POSTGRES_PASSWORD` z části 2; pro bucket proveďte kroky u poskytovatele z části 1.
   Pro SeaweedFS z `compose.yml` přidejte do `.env` jen řádek `COMPOSE_PROFILES` a dva řádky s klíči z jeho odstavce v části 1, pak ho spusťte příkazem `docker compose up -d s3`; `migrate` ho nespustí.
3. Zastavte server, aby se během kopírování nic neměnilo:

   ```bash
   docker compose stop yournotes
   ```

   `migrate` za běhu serveru odmítne pracovat a řekne to.
4. Spusťte `migrate` a nové místo mu zadejte pomocí `TARGET_` před každým nastavením.
   Přesun záznamů do PostgreSQL z `compose.yml`, s heslem, které jste si vymysleli:

   ```bash
   docker compose run --rm -e TARGET_DATABASE_URL=postgres://yournotes:make-up-a-long-password@postgres:5432/yournotes yournotes node dist/cli.js migrate
   ```

   Přesun příloh do bucketu, s hodnotami od poskytovatele z části 1:

   ```bash
   docker compose run --rm \
     -e TARGET_BLOB_STORE=s3 \
     -e TARGET_S3_ENDPOINT=https://s3.your-provider.example \
     -e TARGET_S3_REGION=us-east-1 \
     -e TARGET_S3_BUCKET=yournotes \
     -e TARGET_S3_ACCESS_KEY_ID=your-key-id \
     -e TARGET_S3_SECRET_ACCESS_KEY=your-secret-key \
     yournotes node dist/cli.js migrate
   ```

   Pro SeaweedFS z `compose.yml` použijte jeho hodnoty z části 1 a přidejte `-e TARGET_S3_FORCE_PATH_STYLE=true`.
   Chcete-li přesunout obojí, dejte všechny tyto řádky `-e` do jednoho příkazu.
   Nastavení, které vynecháte, zůstane, jak je, takže se přesune jen to, co uvedete.
   Příkaz vypíše „Copied“ s počtem zkopírovaných záznamů a souborů příloh.
   Chcete-li přesunout soubory starší verze YourNotes z kořene bucketu do `yournotes/`, ponechte v `.env` `S3_PREFIX=` a uveďte jen novou složku:

   ```bash
   docker compose run --rm -e TARGET_S3_PREFIX=yournotes/ yournotes node dist/cli.js migrate
   ```

5. Teď změňte nastavení: přidejte do `.env` řádek `DATABASE_URL` z části 2, nebo řádky S3 z části 1, a spusťte YourNotes příkazem `docker compose up -d`.
   Po přesunu do `yournotes/` naopak smažte řádek `S3_PREFIX=`.
   Soubory v kořeni bucketu tam zůstanou nepoužívané a u poskytovatele je můžete smazat.

`migrate` plní jen prázdnou databázi a prázdnou složku bucketu, jinak odmítne; pokud selže, vezme zpět, co zkopíroval, takže ho můžete spustit znovu.
Pro přesun zpět ho spusťte obráceně: `-e TARGET_DATABASE_URL=` bez ničeho za `=` znamená soubor na počítači a `-e TARGET_BLOB_STORE=disk` disk počítače.
Stará kopie, která tam stále leží, se musí nejdřív odstranit, protože `migrate` neplní místo, kde už jsou data.
Při zastaveném serveru ji odstraňte z místa, kam se vracíte.
Záznamy v souboru na počítači:

```bash
docker compose run --rm yournotes rm -f /data/yournotes.db /data/yournotes.db-wal /data/yournotes.db-shm
```

Přílohy na disku počítače:

```bash
docker compose run --rm yournotes rm -rf /data/blobs
```

PostgreSQL nebo SeaweedFS z `compose.yml`: nejdřív spusťte `docker compose down` a pak ten z příkazů, který potřebujete:

```bash
docker volume rm yournotes_postgres-data
docker volume rm yournotes_s3-data
```
