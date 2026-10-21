# Setting up YourNotes at home

This guide takes you from nothing to your Notes syncing between your phone and your laptop.
You do not need to be a programmer.
Copy every command exactly as written; lines starting with `#` inside a command box are explanations, not commands.

## 1. What you are setting up

One machine in your home runs the YourNotes server.
Your phones and laptops open it in a web browser and install it as an app.
Your Notes live on that one machine, and every Device you sign in keeps a copy that works offline.
Nothing is sent to anyone else's computer.
You are the Owner: the first account, the only one that can invite others.

## 2. Before you start

You need:

- A machine that stays switched on: a Raspberry Pi, an old laptop, a home server or a NAS.
  Its operating system should be Linux; most NAS systems and every Raspberry Pi are.
- Docker on that machine.
  Docker is the program that runs the server in a sealed box so nothing else on the machine is touched.
  Install it with Docker's own instructions: <https://docs.docker.com/engine/install/>.
  Then follow "Manage Docker as a non-root user" on <https://docs.docker.com/engine/install/linux-postinstall/>, so the commands below work without `sudo`.
- About ten minutes.

You type the commands in a terminal on that machine, or over SSH from another computer.
To check Docker is ready, run:

```bash
docker compose version
```

It should print `Docker Compose version` followed by a number.
If it says `docker: 'compose' is not a docker command`, Docker's install page above also installs Compose; follow it again.

## 3. Choose how your Devices will reach it

Browsers only allow an app to work offline and use the microphone and camera when the address is secure (it starts with `https://` and has a trusted certificate).
So the first choice is how your Devices get that secure address.
Pick one of the three ways below and remember its two settings; you will type them in section 4.

| Way | Works away from home | Extra app on each Device | Router changes | Certificate to install on each Device |
|---|---|---|---|---|
| 3a. Tailscale (recommended) | Yes | Tailscale | No | No |
| 3b. Your own domain | Yes | No | Yes | No |
| 3c. Only at home | No, only on your home Wi-Fi | No | One small one | Yes |

If you are unsure, choose Tailscale.
Choose "Only at home" if you do not want to install anything extra and only use YourNotes at home.

### 3a. Tailscale (recommended)

Tailscale is a free private network between your own devices.
It gives the machine a name like `homebox.tail1234.ts.net` with a real certificate, works away from home, and needs no changes to your router.

1. Install Tailscale on the machine and on every phone and laptop that will use YourNotes: <https://tailscale.com/download>.
   Sign in with the same account everywhere.
   On a phone, open the Tailscale app and switch it on; it should say "Connected".
   Leave it on whenever you want YourNotes to sync.
2. Open the DNS page of the Tailscale admin console: <https://login.tailscale.com/admin/dns>.
   Turn on **MagicDNS**, then turn on **HTTPS Certificates**.
3. Open the Machines page: <https://login.tailscale.com/admin/machines>.
   Click your machine; its full name ends in `.ts.net`, for example `homebox.tail1234.ts.net`.

Your two settings:

```bash
YOURNOTES_HOST=homebox.tail1234.ts.net
YOURNOTES_TLS=auto
```

Use your own machine's name, not the example.
There is one more change in `compose.yml`, shown in section 4.

### 3b. Your own domain

Use this if you own a domain name, for example `example.com`, and want YourNotes reachable from anywhere on the internet.
It needs your router to let the internet in, which is why it is not the recommended path.

1. At your domain provider, add an `A` record for a name such as `notes.example.com` pointing to your home's public IP address (<https://ifconfig.me> shows it).
2. In your router, forward ports `80` and `443` to the machine's local address.
   Your router's manual calls this "port forwarding".

Your two settings:

```bash
YOURNOTES_HOST=notes.example.com
YOURNOTES_TLS=auto
```

### 3c. Only at home, without internet

Use this if the machine should never be reachable from outside your home network.
Your Devices sync only while they are on the same Wi-Fi as the machine; away from home they keep working offline and catch up when they are back.
The server makes its own certificate, and each Device has to be told to trust it once, in section 4.

1. Find the machine's local address:

   ```bash
   hostname -I
   ```

   It prints one or more addresses separated by spaces, for example `192.168.1.50 172.17.0.1`.
   Use the one that starts with `192.168.` or `10.`.
   Ignore any that start with `172.` (Docker's own) or `100.` (Tailscale's).
2. In your router, reserve that address for the machine, so it never changes.
   Routers call this "DHCP reservation" or "static lease"; your router's manual shows where.
   Without it, the address can change after a restart and your Devices lose the server.

Your two settings, with your own address:

```bash
YOURNOTES_HOST=192.168.1.50
YOURNOTES_TLS=internal
```

## 4. Start it

Make a folder for YourNotes and download its three files into it:

```bash
mkdir yournotes
cd yournotes
curl -fsSLO https://gitlab.fit.cvut.cz/soukuj26/ni-dip-be/-/raw/v0.1.0/compose.yml
curl -fsSLO https://gitlab.fit.cvut.cz/soukuj26/ni-dip-be/-/raw/v0.1.0/Caddyfile
curl -fsSLO https://gitlab.fit.cvut.cz/soukuj26/ni-dip-be/-/raw/v0.1.0/.env.example
```

Make your own settings file from the example and open it in a text editor:

```bash
cp .env.example .env
nano .env
```

Change the `YOURNOTES_HOST` and `YOURNOTES_TLS` lines to the two settings from section 3.
Leave everything else as it is.
Save with `Ctrl+O` and `Enter`, then close the editor with `Ctrl+X`.

**Tailscale only**: open `compose.yml` the same way (`nano compose.yml`) and find this line near the middle:

```yaml
      # - /var/run/tailscale/tailscaled.sock:/var/run/tailscale/tailscaled.sock
```

Delete the `# ` at its start, keeping the spaces before it, so it reads:

```yaml
      - /var/run/tailscale/tailscaled.sock:/var/run/tailscale/tailscaled.sock
```

Start YourNotes:

```bash
docker compose up -d
```

The first start downloads the server and takes a minute or two.
Then show the server's messages:

```bash
docker compose logs yournotes
```

Near the end you will see "No Owner yet", a link, and a large square QR code.
The link looks like `https://homebox.tail1234.ts.net/pair#…` with a long code at the end.
Check that the address in it is the one you chose in section 3.
If it says `localhost` or something else, `YOURNOTES_HOST` in `.env` is not set right: fix it and run `docker compose up -d` again.

<!-- screenshot: the server log showing "No Owner yet", the Pairing Link and the QR code -->

That link creates your account, so treat it like a key.
It works once.
Restarting the server makes a new one and the old one stops working; to get a fresh link at any time before you have set up, run:

```bash
docker compose restart yournotes
docker compose logs yournotes
```

### Only at home (3c): trust the certificate

Skip this with Tailscale or your own domain.

With the at-home setup, every Device has to trust the server's certificate once, before you open YourNotes on it.
Otherwise the browser shows a warning that the connection is not private, and the app cannot work offline.

Copy the certificate out of the server, in the `yournotes` folder:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./yournotes-root.crt
```

Send the file `yournotes-root.crt` to each Device, for example by email to yourself, then:

- **iPhone or iPad**: open the file in Safari or Mail and allow the download.
  Go to Settings, General, VPN & Device Management, tap the profile whose name starts with "Caddy Local Authority" and tap Install.
  Then go to Settings, General, About, Certificate Trust Settings, and switch it on.
  Both parts are needed; the second is easy to miss.
- **Android**: go to Settings, Security, Encryption & credentials, Install a certificate, CA certificate, and pick the file.
  The menu names differ a little between phone makers; search Settings for "certificate".
- **Windows**: double-click the file, click Install Certificate, choose Local Machine, then "Place all certificates in the following store", Browse, Trusted Root Certification Authorities.
- **Mac**: double-click the file to add it to Keychain Access, double-click the certificate there, open Trust, and set "When using this certificate" to Always Trust.
- **Firefox on any computer** keeps its own list: open Settings, search for "certificates", click View Certificates, open Authorities, click Import, pick the file and tick "Trust this CA to identify websites".

Close and reopen the browser afterwards.
To check it worked, open `https://` followed by your address, for example `https://192.168.1.50`: it should open without a warning.

## 5. Create the Owner

Pick the Device you want to use YourNotes on first, for example your phone.

1. With Tailscale, make sure the Tailscale app on it is switched on.
   At home, make sure it is on your home Wi-Fi.
2. Scan the QR code from section 4 with its camera, or type the link into its browser exactly, including everything after the `#`.
3. The page "Create the Owner" opens.
   Choose a username and a password, then tap "Create the Owner".
4. You are now the Owner, and this Device is signed in.

<!-- screenshot: the "Create the Owner" page on a phone -->

Write the password down somewhere safe.
New Devices normally join by scanning a link from a Device that is already signed in, so you will rarely type it.
But when no signed-in Device is left to show a link, for example after losing your only phone, the password is the way back in.

This first link is now used up.
Opening it on a second Device only shows "This link has expired or was already used"; add every other Device through section 6 instead.

To install YourNotes as an app, open the browser's menu and choose "Add to Home Screen" (phones) or "Install" (laptops).
Always install it from the server's address, as above.
YourNotes syncs with the server it was opened from, so a copy installed from anywhere else never reaches your server.

## 6. Add your other Devices

Do this for each phone, tablet or laptop you want to sync.

1. On a Device that is already signed in, open Settings with the gear icon at the top, scroll to Devices and tap "Add a Device".
   If the app is in Czech, these are "Nastavení", "Zařízení" and "Přidat zařízení".
   It shows a Pairing Link as a QR code.
2. On the new Device, check it can reach the server: Tailscale switched on, or on your home Wi-Fi.
   With the at-home setup (3c), trust the certificate on it first.
3. Scan the QR code with the new Device's camera.
   A laptop has no camera to scan with: tap "Copy link" ("Kopírovat odkaz") instead, send the link to the laptop, for example by email to yourself, and open it in the laptop's browser.
4. The page "Add this Device" opens; tap "Sign in".
   The Device is signed in to your account, without typing a password, and your Notes start to arrive.
5. Install it as an app, as in section 5.

<!-- screenshot: Settings, Devices with the "Add a Device" button -->
<!-- screenshot: the Pairing Link QR code shown by "Add a Device" -->
<!-- screenshot: the "Add this Device" page on the new phone -->

The link works once and for ten minutes.
If it has run out, tap "Add a Device" again for a new one.

To check that sync works, write a Note on one Device and wait a few seconds: it appears on the other.

Each Device shows up in Settings, Devices.
If you lose one, remove it there; it is signed out and nothing else changes.

## 7. Add a household member

1. As the Owner, open Settings ("Nastavení"), scroll to Members ("Členové") and tap "Invite" ("Pozvat").
   It shows a QR code.
2. The other person makes sure their phone can reach the server, as in section 6.
   With Tailscale, that means you share the machine with them in Tailscale, or they sign in to the same Tailscale account.
3. They scan the QR code, see the page "Join", choose their own username and password, and tap "Create my account".

Their Notes are separate from yours: neither of you sees the other's Notes.
The invitation works once and for ten minutes.

## 8. Back up and restore

Everything YourNotes knows is stored inside Docker, in a place called a volume.
A backup copies it into a `backups` folder next to your settings, where you can copy it onto a USB stick or another computer.

The first time, from inside the `yournotes` folder, make the folder and hand it to the account YourNotes runs as inside Docker, number 1000:

```bash
mkdir -p backups && sudo chown 1000:1000 backups
```

Make a backup now:

```bash
docker compose run -T --rm -v ./backups:/backups yournotes node dist/cli.js backup /backups/$(date +%F)
```

It makes a folder named after today's date, for example `backups/2026-09-28`, and prints "Backed up" with how many records of each kind it copied.
It is safe to run while YourNotes is in use.
It works the same with the records in PostgreSQL or the Attachments in an S3 bucket ([the backends page](setup-backends.md)): the folder holds both.
A second backup on the same day needs a different name, for example `/backups/$(date +%F)-evening`.
If a backup stops halfway, its folder has no `manifest.json` in it; delete the folder and run the command again.

Only that account may read a backup, since it holds everything, Share Links included.
On most machines it is your own account; if it is not, copying or deleting a backup needs `sudo`:

```bash
sudo rm -r backups/2026-09-28
```

To back up every night at 3:00, open the scheduled-tasks list:

```bash
crontab -e
```

Add this line at the bottom, replacing `/home/you/yournotes` with your folder (`pwd` prints it):

```bash
0 3 * * * cd /home/you/yournotes && docker compose run -T --rm -v ./backups:/backups yournotes node dist/cli.js backup /backups/$(date +\%F)
```

The `\%` is on purpose: the scheduler needs it.
Old backups are not removed automatically; delete them from time to time.

To restore a backup, replacing everything on the server with it:

```bash
docker compose down
docker compose run --rm -v ./backups/2026-09-28:/backup:ro yournotes sh -c 'rm -rf /data/* && node dist/cli.js restore /backup'
docker compose up -d
```

Use the date of the backup you want.
The second line empties the server's data and loads the backup into it, then prints "Restored".
Do not skip the first line: the second empties the data even while YourNotes is running, before restore can tell that it is.
If the backup is damaged or incomplete, it says so and loads none of it; restore an older backup instead.
Anything written after that backup is gone from the server.
Devices that synced after that backup will re-download everything on their next sync.
Devices added after that backup are signed out and must be added again, as section 6 shows.
Restoring is for when the machine's data is lost or broken, not for undoing one change.

Restore fills only an empty server, so with PostgreSQL or an S3 bucket, empty those too before the second line:

- For the PostgreSQL in `compose.yml`, run `docker volume rm yournotes_postgres-data` after `docker compose down`; the second line starts it again, empty.
- For the SeaweedFS bucket in `compose.yml` (section 1 of [the backends page](setup-backends.md#1-keep-attachments-in-an-s3-bucket)), run `docker volume rm yournotes_s3-data` after `docker compose down`, then `docker compose up -d s3`, which makes the bucket again, empty; the second line does not start it.
- For a PostgreSQL server of your own, delete the database and create it again, empty.
- Empty a bucket of your own with your provider's tools.

A backup folder with a `younotes.db` file in it and no `manifest.json` was made by an earlier version of YourNotes.
Restore cannot read it; put it back by copying the files, under the name this version uses:

```bash
docker compose down
docker compose run --rm --user root -v ./backups/2026-09-28:/backup:ro yournotes sh -c 'rm -rf /data/* && cp -a /backup/. /data/ && for f in /data/younotes.db*; do mv "$f" "/data/yournotes${f#/data/younotes}"; done && chown -R node:node /data'
docker compose up -d
```

## 9. Upgrade

Each release has a version number such as `v0.2.0`.
There is no way back to an older version except restoring a backup, so every upgrade starts with one.

1. Make a backup as section 8 shows, before you change anything.
   Not after editing `.env`: the backup command runs the version `.env` names, and a newer one would update the data under the server still running, so the backup would hold the new layout.
2. Open your settings (`nano .env`), change the `YOURNOTES_VERSION` line to the new number, and save.
3. Run:

   ```bash
   docker compose pull
   docker compose up -d
   ```

The server updates its data on start by itself.
To go back, set `YOURNOTES_VERSION` to the old number again, then restore the backup as section 8 shows.

## 10. Forgot the Owner password

From inside the `yournotes` folder, run:

```bash
docker compose exec yournotes node dist/cli.js reset-owner-password
```

It prints a new password once.
Sign in with it, then write it down.
Devices that are already signed in stay signed in.
A household member who forgot their password asks the Owner, who opens Settings, Members, taps "Set a new password" next to their name, and tells them the new one.

## 11. Your data: who can see what

| How you set it up | Who can reach the server | Who can read your Notes |
|---|---|---|
| 3a. Tailscale | Only devices signed in to your Tailscale account, and anyone you share the machine with in Tailscale | You on your Devices, and whoever runs the server |
| 3b. Your own domain | Anyone on the internet can reach the sign-in page | You on your Devices, whoever runs the server, and anyone holding a Share Link to one of your Notes |
| 3c. Only at home | Anyone on your home network | You on your Devices, and whoever runs the server |

Some things to know plainly:

- The person who runs the server can read the database, and with it every Note of every account on it.
  In a household that is usually you; choose who runs it with that in mind.
- There is no end-to-end encryption: the server stores Notes as they are.
- A household member's Notes are separate from yours in the app, but not from the person who runs the server.
- A Share Link, a read-only link to one Note, opens for anyone who can reach the server, signed in or not.
  With your own domain (3b) that is the whole internet.
- Backups are complete copies; keep them as safe as the machine itself.
- If you keep Attachments in an S3 bucket (section 1 of [the backends page](setup-backends.md#1-keep-attachments-in-an-s3-bucket)), the storage provider holds them too and can read them.
- If you keep the records on a PostgreSQL server someone else runs (section 2 of [the backends page](setup-backends.md#2-keep-the-records-in-postgresql)), they can read your Notes too.

## 12. When something goes wrong

**The browser warns that the connection is not private.**
With the at-home setup (3c), this Device does not trust the certificate yet; repeat the steps in 3c for it, and on an iPhone make sure the switch in Certificate Trust Settings is on.
With Tailscale, check that HTTPS Certificates is on in the admin console and that you removed the `# ` in `compose.yml`; `docker compose logs caddy` shows what went wrong.

**The QR link does not open, or the app says "Could not reach your server".**
The Device cannot reach the server: with Tailscale, check the Tailscale app is switched on and says "Connected"; at home, check the Device is on the home Wi-Fi, not mobile data.

**The page says "This link has expired or was already used".**
Every link works once.
If you already created the Owner on another Device, this is expected: add this Device from a signed-in one instead (section 6).
A link from "Add a Device" or "Invite" also runs out after ten minutes; tap the button again for a new one.
If nobody has created the Owner yet, run `docker compose restart yournotes` and use the new link from `docker compose logs yournotes`.

**The page says "This link is incomplete".**
The long code after the `#` was cut off, which happens when the link is typed by hand or copied only partly.
Scan the QR code instead, or copy the whole link.

**Notes do not appear on the other Device.**
Check that both Devices are listed in Settings, Devices, and that both can reach the server.
Check that the app on both was opened from the same address (section 5): a copy installed from another address syncs with nothing.
Sync happens in the background; switching to another app and back makes it try again at once.

**`docker compose up -d` says "address already in use".**
Another program on the machine already uses port 80 or 443, usually another web server.
This shows which one:

```bash
sudo ss -ltnp | grep -E ':(80|443) '
```

Stop that program, or run YourNotes on a different machine.

**The log says "No Owner yet" although you already set up.**
The log keeps messages from earlier starts; look only at the newest lines:

```bash
docker compose logs --tail 40 yournotes
```

If the newest start still says "No Owner yet", the server is starting with empty data.
That happens after `docker compose down -v`: the `-v` deletes all stored data, so never add it.
Restore a backup (section 8) to get your Notes back.

## 13. Optional: PostgreSQL, an S3 bucket, or moving between them

By default YourNotes keeps the records and the Attachments on the machine, and that is the right choice for almost every home.
To keep the Attachments in an S3 bucket, the records in PostgreSQL, or to move a running server to either, follow [YourNotes with PostgreSQL or an S3 bucket](setup-backends.md).
