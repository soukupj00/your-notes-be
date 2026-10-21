# YourNotes with PostgreSQL or an S3 bucket

This page continues the [setup guide](setup.md), for the few homes that want the records or the Attachments somewhere other than the machine itself.
Most homes need none of it: by default YourNotes keeps everything on the machine.
Run every command from inside the `yournotes` folder, as in the guide.

## 1. Keep Attachments in an S3 bucket

Attachments are the photos, recordings and files you add to Notes.
Normally the server keeps them on the machine, next to your Notes.
If the machine's disk is small, it can keep them in an S3 bucket instead: online storage that many providers sell, such as Amazon S3, Backblaze B2 or Cloudflare R2.
Your Notes themselves stay on the machine, but the Attachments then live on the provider's computers, and the provider can read them.
Most homes do not need this; skip it unless you do.

Decide this when you first set up, or move a running server's Attachments into the bucket as section 3 shows.
Only changing the settings would leave the Attachments you already have out of reach.

At your provider:

1. Create a bucket, for example `yournotes`, and keep it private: never turn on public access.
   The server hands out every Attachment itself, and that is what keeps Share Links and the safety checks on Attachments working.
2. The server keeps its files in the folder `yournotes/` of the bucket, and regularly removes anything in that folder that it does not know about.
   It never touches the rest of the bucket.
3. Create an access key that may list, read, write and delete in that bucket.
   The provider shows a key ID and a secret key; the secret is often shown only once, so copy it straight away.
4. Turn on versioning for the bucket, if the provider offers it.
   Versioning keeps earlier copies of every file, so a deleted Attachment can be brought back even between two backups.
   The backup in [section 8 of the setup guide](setup.md#8-back-up-and-restore) copies the Attachments in the bucket too.

Then open your settings (`nano .env`) and add these lines, with your provider's values:

```bash
BLOB_STORE=s3
S3_ENDPOINT=https://s3.your-provider.example
S3_REGION=us-east-1
S3_BUCKET=yournotes
S3_ACCESS_KEY_ID=your-key-id
S3_SECRET_ACCESS_KEY=your-secret-key
```

`S3_ENDPOINT` is the S3 address from your provider's instructions; for Amazon S3 itself, leave that line out.
`S3_REGION` is the region the provider shows for the bucket; if it shows none, keep `us-east-1`.
Some providers also need `S3_FORCE_PATH_STYLE=true`; their instructions say so.
To keep the files in another folder of the bucket, add `S3_PREFIX=` with the folder's name and a `/` at the end, such as `S3_PREFIX=notes/`.
`S3_PREFIX=` with nothing after the `=` means the top of the bucket, and then the server treats the whole bucket as its own.
The two keys open your bucket, so keep `.env` as private as the machine.

A bucket that an earlier YourNotes filled holds the files at its top, not in `yournotes/`.
Keep using it with `S3_PREFIX=` with nothing after the `=`, or move the files into `yournotes/` with `migrate`, as the end of section 3 shows.

Start YourNotes again with `docker compose up -d`.
On every start the server waits up to half a minute for the bucket, saying "Waiting for S3 bucket" in `docker compose logs yournotes`, and then stops with the reason, for example "no such bucket".
Keys the provider refuses stop it straight away, with "access denied".
The messages name the bucket and the address, never the keys.

To try this without a provider, the `compose.yml` file can run SeaweedFS, an S3 bucket on the same machine.
Add these lines to `.env` instead of the ones above, with two keys you make up, before SeaweedFS first starts, since it takes them as its own login:

```bash
COMPOSE_PROFILES=s3
BLOB_STORE=s3
S3_ENDPOINT=http://s3:8333
S3_BUCKET=yournotes
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY_ID=make-up-a-key-id
S3_SECRET_ACCESS_KEY=make-up-a-long-secret
```

With PostgreSQL from section 2 as well, the first line is `COMPOSE_PROFILES=postgres,s3`.
Then start with `docker compose up -d`.
Never add `--profile` to a `docker compose` command: it replaces `COMPOSE_PROFILES`, so `--profile s3` would leave the database of section 2 out.
The Attachments stay on the same machine that way, so it is only for trying it out.

## 2. Keep the records in PostgreSQL

Normally the server keeps your Notes, accounts and Devices in one file on the machine, and that is the right choice for almost every home.
If you already run a PostgreSQL database, or want to look after the records with its own tools, the server can keep them there instead.
Attachments stay where they are: on the machine, or in your S3 bucket (section 1).

Decide this when you first set up, or move a running server's records as section 3 shows.
Only changing the settings would make the server start empty.

To run PostgreSQL on the same machine, open your settings (`nano .env`) and add these lines, with a password you make up from letters, digits and dashes:

```bash
COMPOSE_PROFILES=postgres
POSTGRES_PASSWORD=make-up-a-long-password
DATABASE_URL=postgres://yournotes:make-up-a-long-password@postgres:5432/yournotes
```

The password appears twice and must be the same in both lines.
The first line makes every `docker compose` command include the database; with the SeaweedFS of section 1 as well, it is `COMPOSE_PROFILES=postgres,s3`.
Start YourNotes again with `docker compose up -d`.

To use a PostgreSQL server you already run, create an empty database there with a user that owns it, and set only `DATABASE_URL`, in the form `postgres://user:password@address:5432/database`.
The server creates its tables itself when it starts.

On every start the server waits up to half a minute for the database, saying "Waiting for PostgreSQL" in `docker compose logs yournotes`, and then stops with the reason, for example a wrong password.
Its messages name the database's address, never the password.

Only one YourNotes server may use a database.
A second one stops straight away and says "Another YourNotes server is already using PostgreSQL".

The backup in [section 8 of the setup guide](setup.md#8-back-up-and-restore) works the same with PostgreSQL.
PostgreSQL's own `pg_dump` is another way to back up the records, as its guide describes: <https://www.postgresql.org/docs/17/backup-dump.html>.

## 3. Move a running server to PostgreSQL or S3

Once YourNotes holds your Notes, moving them is one command, `migrate`, which copies everything into the new place.
Every Device stays signed in and keeps syncing as if nothing happened.
The old copy stays where it was, unused, so you can go back by undoing the settings.

1. Make a backup, as [section 8 of the setup guide](setup.md#8-back-up-and-restore) shows.
2. Get the new place ready, but do not change the server's settings yet: for PostgreSQL in `compose.yml`, add only the `COMPOSE_PROFILES` and `POSTGRES_PASSWORD` lines of section 2 to `.env`; for a bucket, follow the steps at your provider in section 1.
   For the SeaweedFS in `compose.yml`, add only the `COMPOSE_PROFILES` line and the two key lines of its part of section 1 to `.env`, then start it with `docker compose up -d s3`; `migrate` does not start it.
3. Stop the server, so nothing changes while it copies:

   ```bash
   docker compose stop yournotes
   ```

   `migrate` refuses while the server is running and says so.
4. Run `migrate`, telling it the new place with `TARGET_` in front of each setting.
   To move the records to the PostgreSQL in `compose.yml`, with the password you made up:

   ```bash
   docker compose run --rm -e TARGET_DATABASE_URL=postgres://yournotes:make-up-a-long-password@postgres:5432/yournotes yournotes node dist/cli.js migrate
   ```

   To move the Attachments to a bucket, with your provider's values from section 1:

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

   For the SeaweedFS in `compose.yml`, use its values from section 1 and add `-e TARGET_S3_FORCE_PATH_STYLE=true`.
   To move both, put all of those `-e` lines in one command.
   A setting you leave out stays as it is, so only what you name moves.
   It prints "Copied", with how many records and Attachment files it copied.
   To move the files of an earlier YourNotes from the top of the bucket into `yournotes/`, with `S3_PREFIX=` still in `.env`, name only the new folder:

   ```bash
   docker compose run --rm -e TARGET_S3_PREFIX=yournotes/ yournotes node dist/cli.js migrate
   ```

5. Now change the settings: add the `DATABASE_URL` line of section 2, or the S3 lines of section 1, to `.env`, and start YourNotes with `docker compose up -d`.
   After a move into `yournotes/`, delete the `S3_PREFIX=` line instead.
   The files at the top of the bucket stay there, unused, and you may delete them at your provider.

`migrate` fills only an empty database and an empty bucket folder, and refuses otherwise; if it fails, it takes back what it copied, so you can run it again.
To move back, run it the other way round: `-e TARGET_DATABASE_URL=` with nothing after the `=` means the file on the machine, and `-e TARGET_BLOB_STORE=disk` the machine's disk.
The old copy still lying there must be removed first, because `migrate` will not fill a place that holds data.
With the server stopped, remove it from the place you move back to.
The records in the file on the machine:

```bash
docker compose run --rm yournotes rm -f /data/yournotes.db /data/yournotes.db-wal /data/yournotes.db-shm
```

The Attachments on the machine's disk:

```bash
docker compose run --rm yournotes rm -rf /data/blobs
```

The PostgreSQL or the SeaweedFS in `compose.yml`: run `docker compose down` first, then the one you need of

```bash
docker volume rm yournotes_postgres-data
docker volume rm yournotes_s3-data
```
