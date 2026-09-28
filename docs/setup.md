# Setting up YouNotes at home

This guide takes you from nothing to your Notes syncing between your phone and your laptop.
You do not need to be a programmer.
Copy every command exactly as written; lines starting with `#` inside a command box are explanations, not commands.

## 1. What you are setting up

One machine in your home runs the YouNotes server.
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
Pick one of the three ways below and remember its two settings; you will type them in step 4.

### 3a. Tailscale (recommended)

Tailscale is a free private network between your own devices.
It gives the machine a name like `homebox.tail1234.ts.net` with a real certificate, works away from home, and needs no changes to your router.

1. Install Tailscale on the machine and on every phone and laptop that will use YouNotes: <https://tailscale.com/download>.
   Sign in with the same account everywhere.
2. Open the DNS page of the Tailscale admin console: <https://login.tailscale.com/admin/dns>.
   Turn on **MagicDNS**, then turn on **HTTPS Certificates**.
3. Open the Machines page: <https://login.tailscale.com/admin/machines>.
   Click your machine; its full name ends in `.ts.net`, for example `homebox.tail1234.ts.net`.

Your two settings:

```bash
YOUNOTES_HOST=homebox.tail1234.ts.net
YOUNOTES_TLS=auto
```

Use your own machine's name, not the example.
There is one more change in `compose.yml`, shown in step 4.

### 3b. Your own domain

Use this if you own a domain name, for example `example.com`, and want YouNotes reachable from anywhere on the internet.
It needs your router to let the internet in, which is why it is not the recommended path.

1. At your domain provider, add an `A` record for a name such as `notes.example.com` pointing to your home's public IP address (<https://ifconfig.me> shows it).
2. In your router, forward ports `80` and `443` to the machine's local address.
   Your router's manual calls this "port forwarding".

Your two settings:

```bash
YOUNOTES_HOST=notes.example.com
YOUNOTES_TLS=auto
```

### 3c. Only at home, without internet

Use this if the machine should never be reachable from outside your home network.
The server makes its own certificate, and each Device has to be told to trust it once.

1. Find the machine's local address:

   ```bash
   hostname -I
   ```

   Use the first address it prints, for example `192.168.1.50`.
2. In your router, reserve that address for the machine ("DHCP reservation"), so it never changes.

Your two settings:

```bash
YOUNOTES_HOST=192.168.1.50
YOUNOTES_TLS=internal
```

After step 4, trust the certificate on every Device before you open YouNotes on it.
First copy the certificate out of the server, in the `younotes` folder from step 4:

```bash
docker compose cp caddy:/data/caddy/pki/authorities/local/root.crt ./younotes-root.crt
```

Send the file `younotes-root.crt` to each Device, for example by email to yourself, then:

- **iPhone or iPad**: open the file and allow the download.
  Go to Settings, General, VPN & Device Management, tap the profile and tap Install.
  Then go to Settings, General, About, Certificate Trust Settings, and switch it on.
- **Android**: go to Settings, Security, Encryption & credentials, Install a certificate, CA certificate, and pick the file.
  The menu names differ a little between phone makers; search Settings for "certificate".
- **Windows**: double-click the file, click Install Certificate, choose Local Machine, then "Place all certificates in the following store", Browse, Trusted Root Certification Authorities.
- **Mac**: double-click the file to add it to Keychain Access, double-click the certificate there, open Trust, and set "When using this certificate" to Always Trust.

## 4. Start it

Make a folder for YouNotes and download its three files into it:

```bash
mkdir younotes
cd younotes
curl -fsSLO https://gitlab.fit.cvut.cz/soukuj26/ni-dip-be/-/raw/v0.1.0/compose.yml
curl -fsSLO https://gitlab.fit.cvut.cz/soukuj26/ni-dip-be/-/raw/v0.1.0/Caddyfile
curl -fsSLO https://gitlab.fit.cvut.cz/soukuj26/ni-dip-be/-/raw/v0.1.0/.env.example
```

Make your own settings file from the example and open it in a text editor:

```bash
cp .env.example .env
nano .env
```

Change the `YOUNOTES_HOST` and `YOUNOTES_TLS` lines to the two settings from step 3.
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

Start YouNotes:

```bash
docker compose up -d
```

The first start downloads the server and takes a minute or two.
Then show the server's messages:

```bash
docker compose logs younotes
```

Near the end you will see "No Owner yet", a link, and a large square QR code.
The link looks like `https://homebox.tail1234.ts.net/pair#…` with a long code at the end.

That link creates your account, so treat it like a key.
It works once.
Restarting the server makes a new one and the old one stops working; to get a fresh link at any time before you have set up, run:

```bash
docker compose restart younotes
docker compose logs younotes
```

## 5. Create the Owner

On the Device you want to use first, scan the QR code with the camera, or type the link into the browser.
Choose a username and a password.
You are now the Owner, and this Device is signed in.

Write the password down somewhere safe.
New Devices normally join by scanning a link from a Device that is already signed in, so you will rarely type it.
But when no signed-in Device is left to show a link, for example after losing your only phone, the password is the way back in.

To install YouNotes as an app, use the browser's "Add to Home Screen" (phones) or "Install" (laptops).

## 6. Add a phone

The screens for this are being built in the app; the words may differ.

1. On a Device that is already signed in, open Settings, then Devices, then "Add a Device".
   It shows a Pairing Link as a QR code.
2. Scan it with the new phone's camera.
   The phone opens YouNotes and is signed in to your account, without typing a password.

The link works once and for ten minutes.
The phone must be able to reach the server the way you chose in step 3: in Tailscale, on the same network at home, or through the internet with your own domain.
With the at-home setup (3c), trust the certificate on the phone first.

Each Device shows up in Settings, Devices.
If you lose one, remove it there; it is signed out and nothing else changes.

## 7. Add a household member

The screens for this are being built in the app; the words may differ.

1. As the Owner, open Settings, then Members, then "Invite".
   It shows a QR code.
2. The other person scans it on their own phone and chooses their own username and password.

Their Notes are separate from yours: neither of you sees the other's Notes.
The invitation works once and for ten minutes.

## 8. Back up and restore

Everything YouNotes knows is stored inside Docker, in a place called a volume.
A backup copies it into a `backups` folder next to your settings, where you can copy it onto a USB stick or another computer.

Make a backup now, from inside the `younotes` folder:

```bash
mkdir -p backups
docker compose run -T --rm --user root -v ./backups:/backups younotes node dist/cli.js backup /backups/$(date +%F)
```

It makes a folder named after today's date, for example `backups/2026-09-28`, and prints "Backed up".
It is safe to run while YouNotes is in use.
A second backup on the same day needs a different name, for example `/backups/$(date +%F)-evening`.

The backup files belong to the system administrator account, so deleting an old one needs `sudo`:

```bash
sudo rm -r backups/2026-09-28
```

To back up every night at 3:00, open the scheduled-tasks list:

```bash
crontab -e
```

Add this line at the bottom, replacing `/home/you/younotes` with your folder (`pwd` prints it):

```bash
0 3 * * * cd /home/you/younotes && docker compose run -T --rm --user root -v ./backups:/backups younotes node dist/cli.js backup /backups/$(date +\%F)
```

The `\%` is on purpose: the scheduler needs it.
Old backups are not removed automatically; delete them from time to time.

To restore a backup, replacing everything on the server with it:

```bash
docker compose down
docker compose run --rm --user root -v ./backups/2026-09-28:/backup:ro younotes sh -c 'rm -rf /data/* && cp -a /backup/. /data/ && chown -R node:node /data'
docker compose up -d
```

Use the date of the backup you want.
Anything written after that backup is gone from the server.
Devices that synced after that backup will re-download everything on their next sync.
Restoring is for when the machine's data is lost or broken, not for undoing one change.

## 9. Upgrade

Each release has a version number such as `v0.2.0`.
To move to a new one, open your settings (`nano .env`), change the `YOUNOTES_VERSION` line to the new number, save, and run:

```bash
docker compose pull
docker compose up -d
```

The server updates its data on start by itself.
Make a backup (step 8) before every upgrade: there is no way back to an older version except restoring that backup.

## 10. Forgot the Owner password

From inside the `younotes` folder, run:

```bash
docker compose exec younotes node dist/cli.js reset-owner-password
```

It prints a new password once.
Sign in with it, then write it down.
Devices that are already signed in stay signed in.
A household member who forgot their password asks the Owner, who can set a new one in the app (that screen is being built; the words may differ).

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

## 12. When something goes wrong

**The browser warns that the connection is not private.**
With the at-home setup (3c), this Device does not trust the certificate yet; repeat the steps in 3c for it, and on an iPhone make sure the switch in Certificate Trust Settings is on.
With Tailscale, check that HTTPS Certificates is on in the admin console and that you removed the `# ` in `compose.yml`; `docker compose logs caddy` shows what went wrong.

**The QR link does not open.**
The Device cannot reach the server: with Tailscale, check Tailscale is on and signed in on that Device; at home, check it is on the home Wi-Fi.
If the page opens but says the link is not valid, it was already used or has expired: run `docker compose restart younotes` and use the new link from `docker compose logs younotes`.

**`docker compose up -d` says "address already in use".**
Another program on the machine already uses port 80 or 443, usually another web server.
This shows which one:

```bash
sudo ss -ltnp | grep -E ':(80|443) '
```

Stop that program, or run YouNotes on a different machine.

**The log says "No Owner yet" although you already set up.**
The log keeps messages from earlier starts; look only at the newest lines:

```bash
docker compose logs --tail 40 younotes
```

If the newest start still says "No Owner yet", the server is starting with empty data.
That happens after `docker compose down -v`: the `-v` deletes all stored data, so never add it.
Restore a backup (step 8) to get your Notes back.
