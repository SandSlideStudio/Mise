# Mise

Recipes and prep lists for professional kitchens, running on your own server.

Recipes in Mise are written like specs: weights, yields, sub-recipes and allergens. The kitchen
keeps one running prep list. Add lines by hand or straight from a recipe, leave a note for the
next shift, and tick lines off on a tablet by the pass. Every screen in the kitchen updates as you
do. Menus group your dishes, with an allergen overview and every dish card in one PDF.

One server is one kitchen. Your recipes stay on a machine you own, and there's no account or
subscription anywhere else.

## Install

You need a computer that stays on in the restaurant (a mini PC, a NAS, any Raspberry Pi from the
Zero 2 W up on a 64-bit system, or any Linux server) with [Docker](https://docs.docker.com/get-docker/) installed.
Then run:

```bash
curl -fsSL https://github.com/SandSlideStudio/Mise/releases/latest/download/install.sh | sh
```

The installer and everything it downloads come from the latest release, never from unfinished work.
Each release lists the files with their SHA-256 checksums in `SHA256SUMS`, if you want to read or
check the installer before running it.

That creates a `mise-kitchen` folder, writes a `.env` with new secrets, starts Mise and prints a
setup link. Open it in a browser and the setup screens take you through naming the kitchen, your
account, stations, staff and a first few recipes. The link has a one-time code in it, so nobody else
on the network can set the kitchen up before you do.

### Without the installer

Download `compose.yaml`, `Caddyfile` and `env.example` from the
[latest release](https://github.com/SandSlideStudio/Mise/releases/latest) into a folder, and rename
`env.example` to `.env`.
Replace both `change-me` values with long random strings (`openssl rand -hex 32` makes one each),
then:

```bash
docker compose up -d
```

Mise won't start while either secret is still `change-me`. The setup link, with its one-time code,
is printed in the log: `docker compose logs app`.

## Tablets and sign-in

Chefs and managers sign in with an email and password, on any device.

Cooks sign in on a kitchen tablet by tapping their name and typing their PIN. That only works on a
tablet you've enrolled: sign in on it as the administrator, go to **Settings → Devices** and enrol
it. Anyone can have a PIN, managers included; whoever sets up the kitchen can choose one during
setup.

A PIN is short, so it never stands between anyone and the kitchen's security. Signed in with a PIN,
a chef can do everything in the kitchen (recipes, dishes, menus, the prep list, stations, dish
cards), but staff, devices, the connection and backups need a password sign-in. Settings shows
those sections greyed out, with a note to sign in with the password.

Five wrong PINs lock that person out for 15 minutes, on every tablet. Each lock after that lasts
twice as long, up to a day, until they sign in. An administrator setting a new PIN lifts it.

Signing out works offline too: the tablet is signed out at once, and Mise hears about it as soon
as it answers again, so the next cook never carries on as the last one.

## From outside the kitchen

On the kitchen network, and on a VPN such as Tailscale, everything works as usual. From anywhere
else, Mise shows only a page to ask for access, not even the sign-in, until a chef or the
administrator approves that device. The device asking gives itself a name and shows a short code;
under **Settings → Devices** the request appears with the same code. Check it with the person
asking, then approve. Approving from outside the kitchen asks for your password again.

An approval lasts until it is revoked, or until the device goes 90 days unused. Requests nobody
answers are dropped after a day. On a server with no kitchen network, such as one in the cloud,
the device that sets Mise up (or restores a backup onto it) is approved automatically.

"Inside" means a visitor's own address is a private one. Docker usually passes that address on,
but rootless Docker, Podman and Docker Desktop relay every connection themselves, as does Docker
for IPv6 when its network has none. Then everyone, wherever they are, arrives from Docker's own
address, and Mise can't tell the kitchen from the internet. So it counts them as outside: each
device asks for access once, and setup asks for the setup code. **Settings → Connection** says
when this happens, and can count them as inside instead, if Mise can't be reached from the
internet. Better still, run Mise with `network_mode: host`, or turn on IPv6 for Docker's network,
so Mise sees each visitor's own address.

**Settings → Connection** can also name the one domain that leads to Mise from outside, such as
`mise.yourkitchen.com`. Then the bare IP address, or another website's name on the same server,
finds nothing at all.

No device approved yet, and no kitchen network to approve one from, such as after updating a
cloud server to 2.2? Ask for access on your phone, then approve it from the server itself with the
code it shows, inside the `mise-kitchen` folder:

```bash
docker compose exec app node Server/dist/index.js approve-device ABC-123
```

On TrueNAS, run the same `node Server/dist/index.js approve-device ABC-123` in the app's shell
(**Apps → mise → Shell**). As a last resort, `OUTSIDE_ACCESS=open` in `.env` lets everyone reach
the sign-in again; put it back once you're in.

## Dish cards

Every dish has a dish card for the floor: its photo and what it is on the front, and every
allergen for each of its components on the back. Dishes have their own **Dishes** tab, where each
one shows as its card, grouped by course, with **Free from** to see what an allergy table can
have. Open a dish to see its whole card on screen, then choose **Print or PDF**, pick the language
and day or night, and print it or download the PDF. Preps and components stay under **Recipes**.

Fill in the **Front of house** part of a dish in the recipe editor, and say on each ingredient
whether it is vegan and, for gluten and nuts, which cereal or nut it is. The card page lists
anything still missing. Under the name, the card says which menu the dish is on: the active menus,
or the menu you're printing from. **Settings → Dish cards** sets the logo, address, which parts
show and the warning printed at the foot of every card, in each language you print in.

## Menus

Under **Menus**, group dishes into a menu for the floor. Choose **Allergen overview** to print
one sheet with every dish and its allergens, or download all the menu's dish cards as a single
PDF. A menu marks the dishes that have changed since its cards were last downloaded, so you know
which ones to reprint.

## When the network drops

A tablet keeps working when the wifi drops or the server is off. It shows everything it had
loaded, and every so often it loads the prep list, every recipe and dish card, and the menus in
the background, so pages nobody has opened yet are there too. A bar at the top says Mise can't be
reached, and since when.

Adding, changing and removing prep lines, ticks, the handover note, and edits to recipes, menus
and ingredients are kept on the tablet and sent, in order, once Mise answers again. If someone
else changed the same recipe, menu or note in the meantime, the tablet shows both versions side by
side and asks which to keep. Creating or deleting recipes, menus and ingredients, photos and the
settings need the connection, and say so.

Over HTTPS (see below), the app itself is kept on the tablet too, so it even opens with the server
switched off, and can be installed on the home screen like an app. Over plain HTTP it keeps
working only while it stays open: browsers allow no more without HTTPS.

## HTTPS

Plain HTTP on port 3000 keeps working whatever you choose here. HTTPS is what lets tablets keep
the app for opening offline and install it, and it's a must for anything reachable from the
internet. All of it is set up under **Settings → Connection**:

- **On the kitchen network.** Mise makes a certificate of its own for the addresses the tablets
  use, such as `192.168.1.50`. No domain or internet needed. Each tablet then opens
  `http://<address>:3000/trust` once and follows the steps for its kind of device (iPad and
  iPhone, Android, Windows, Mac). HTTPS answers on port 3443.
- **For your domain.** Mise gets a free certificate from Let's Encrypt and renews it by itself. Point
  the domain at your public IP and have your router send port 80 on to Mise's port 3000 and port
  443 to 3443. On a server of its own, set `PORT=80` and `HTTPS_PORT=443` in `.env` instead.

Both can be on at once; Mise shows each browser the certificate for the name it asked for.

### Behind a web server you already have

Already have a web server answering for your domains, such as Apache with a few WordPress sites on
the same IP? Let it pass the Mise domain on, with its own certificate, and name it under
**Settings → Connection → Behind another web server**. Mise offers the address it sees requests
coming through, and shows the exact lines for Apache, filled in with your domain. Live updates come
over a stream at `/api/events`: with Apache use `flushpackets=on` (in those lines already), with
nginx turn off `proxy_buffering` for that path.

### Caddy, from the compose file

The compose file can also start Caddy in front of Mise, which gets its own certificate:

1. Point a domain name at the machine, and make sure ports 80 and 443 reach it.
2. In `.env`, set `MISE_DOMAIN` to that name, add `COMPOSE_PROFILES=https`, and set
   `COOKIE_SECURE=true`, `TRUST_PROXY=1` and `MISE_BIND=127.0.0.1`.
3. Start with `docker compose up -d`.

`MISE_BIND=127.0.0.1` keeps Mise's own ports off the network, so every request comes through Caddy.
`TRUST_PROXY=1` lets Mise see each person's real address behind Caddy, which the sign-in limits and
outside access need. Don't set it unless a proxy is in front. Kitchens that set Caddy up before 2.2
get the `COMPOSE_PROFILES` line from the installer on their next update.

## Updating

Run the install command again from inside the `mise-kitchen` folder, or:

```bash
docker compose pull
docker compose up -d
```

The database is updated automatically when Mise starts. Make a backup first. `MISE_VERSION=2` in
`.env` follows every 2.x release; set it to an exact version such as `2.0.0` to stay on that one.
Kitchens installed before 2.0 have `MISE_VERSION=1` and stay on 1.x until you change it. Read the
2.0.0 notes first.
[CHANGELOG.md](CHANGELOG.md) lists what changed in each release.

**Settings → Kitchen** shows which version is running. Once a day Mise asks GitHub whether a newer
one is out and, if so, tells administrators there, with the steps for their kind of install. Only
that request is sent, nothing about the kitchen, and an administrator can switch it off on the same
page. Mise doesn't update itself: that would mean giving it control of the machine it runs on.

## Backups

Mise backs the kitchen up every night by itself: the data and the plating photos, in one encrypted
file. **Settings → Backups** (administrators only) shows when the last one ran, starts one on the
spot, and downloads any of the backups kept on the server. If a backup fails, administrators see a
warning at the top of every page.

Keep a copy off the machine. Download one now and then, or let Mise send every backup to OneDrive,
to a NAS or Nextcloud over WebDAV, which Synology and QNAP boxes offer, or to both at once. All of these are set up
on the same page. OneDrive backups go into the `Apps/Mise` folder, and Mise can't see anything else
in that OneDrive. Setup lets you connect a NAS or OneDrive straight away, and the backups page
says so for as long as they only live on the server.

Every backup is encrypted with the kitchen's recovery key. Print it from **Settings → Backups** and
keep it away from the server. Without it, nobody can open a backup.

### Restoring

On a new or wiped server, open the setup link and choose **Restore a backup** instead of setting up
the kitchen. Pick the backup file and type the recovery key. Staff with their passwords and PINs,
recipes, photos, menus and the prep list all come back, and everyone signs in again afterwards.

Test this once before you need it, on a spare machine or a second install.

### By hand

The database and the photos can also be copied out directly, inside the `mise-kitchen` folder:

```bash
docker compose exec -T db pg_dump -U mise mise > mise-backup.sql
docker compose exec -T app tar czf - -C /data/uploads . > mise-photos.tar.gz
```

To put them back on a fresh install:

```bash
docker compose stop app
docker compose exec -T db psql -U mise -d postgres -c "drop database mise;" -c "create database mise owner mise;"
docker compose exec -T db psql -U mise -d mise < mise-backup.sql
docker compose start app
docker compose exec -T app tar xzf - -C /data/uploads < mise-photos.tar.gz
```

## On a Raspberry Pi

Mise runs on anything from a Raspberry Pi Zero 2 W up. In testing, a busy service with ten tablets
used under 200 MB of memory; the Zero 2 W has 512 MB.

- Install **Raspberry Pi OS Lite (64-bit)**. The 32-bit system can't run Mise.
- Use a wired connection if you can. The Zero 2 W only has 2.4 GHz WiFi, which a running microwave
  drowns out. A micro-USB Ethernet adapter fixes that.
- Buy a high-endurance SD card, the kind made for dashcams, from a proper shop. Mise writes very
  little, but a cheap card can still die without warning.
- Use the official power supply. Too little power is the usual way SD cards get corrupted.
- The first start takes a minute or two. After that, pages open in about a second.

The SD card holds both the kitchen and its nightly backups, so a card that dies takes both with it.
Send the backups to a NAS, or download one now and then.

## On TrueNAS

TrueNAS SCALE 24.10 and newer run Mise as a custom app, without the installer.

1. In the TrueNAS shell (**System → Shell**), run `openssl rand -hex 32` twice. The first is the
   session secret, the second the database password.
2. Go to **Apps → Discover Apps → ⋮ → Install via YAML**.
3. Name the app `mise`. TrueNAS only accepts lowercase letters, digits and hyphens.
4. Paste the YAML below with your two values filled in. The database password goes in twice.
5. Save, wait until the app shows as running, and open `http://<your TrueNAS address>:3000`.

```yaml
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: mise
      POSTGRES_PASSWORD: YOUR_DATABASE_PASSWORD
      POSTGRES_DB: mise
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U mise -d mise']
      interval: 1m
      start_period: 60s
      start_interval: 1s
      timeout: 5s
      retries: 5

  app:
    image: ghcr.io/sandslidestudio/mise-kitchen:2
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      NODE_ENV: production
      DATABASE_URL: postgres://mise:YOUR_DATABASE_PASSWORD@db:5432/mise
      SESSION_SECRET: YOUR_SESSION_SECRET
      UPLOAD_DIR: /data/uploads
      BACKUP_DIR: /data/backups
    ports:
      - '3000:3000'
      - '3443:3443'
    volumes:
      - uploads:/data/uploads
      - backups:/data/backups

volumes:
  db-data:
  uploads:
  backups:
```

From a computer on the kitchen network, setup asks for no code. From anywhere else, or through a
proxy or tunnel, it asks for the code Mise prints in the app's log (**Apps → mise → Logs**). If
Mise will be reachable from the internet, add `SETUP_TOKEN` with a third `openssl rand -hex 32`,
along with the settings from [HTTPS](#https), and open `/setup?token=<that value>`. If port 3000 is
taken, change the first number, as in `'3080:3000'`.

Port 3443 is for HTTPS, once it's turned on under **Settings → Connection**; already installed
without it? Add the line under `ports` and save. Websites in a VM on the same TrueNAS that should
pass a domain on to Mise: TrueNAS VMs often can't reach their own host until the VM is attached
to a bridge (`br0`, under **Network**). The Connection page says how.

Mise runs as any user TrueNAS gives it. The photo and backup folders in the image can be written by
any user for that reason; they live in the app's own volumes, which only this one process uses.

To update, open the app under **Apps** and choose **Update** or **Pull Images**. Keep the YAML
with your values somewhere safe: the same secret and password let a reinstall pick up the existing
data.

## On Oracle Cloud

Oracle's free tier runs Mise well, on either kind of free server: an Ampere (ARM) one, or the
small AMD one with 1 GB of memory. On Ubuntu, over SSH:

1. **Open the ports twice.** In the Oracle console, add ingress rules for TCP 80 and 443 (and 3000
   if you want to reach Mise before HTTPS) to the subnet's security list. Oracle's Ubuntu image also
   blocks them on the server itself:
   ```bash
   sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -m conntrack --ctstate NEW -j ACCEPT
   sudo netfilter-persistent save
   ```
2. **Add swap**, for the moments everything happens at once:
   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
3. **Install Docker.** A new server runs its own updates for a few minutes after first boot; if
   the install says the package manager is locked, wait and try again. If Docker's script stops at
   `docker-model-plugin`, install the parts Mise needs directly:
   ```bash
   sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
   sudo usermod -aG docker ubuntu   # then sign out and back in
   ```
4. **Install Mise** with the command at the top. If something already holds port 80 (`sudo ss -ltnp
'sport = :80'`), such as an nginx nobody uses, stop it: `sudo systemctl disable --now nginx`.
5. **HTTPS:** either set `PORT=80` and `HTTPS_PORT=443` in `.env`, `docker compose up -d`, and turn
   on the certificate for your domain under **Settings → Connection**; or use Caddy as above.

Make the public IP **reserved** in the console so your DNS record stays right, and consider
upgrading the account to Pay As You Go (still free within the free limits): Oracle may reclaim
free servers that sit mostly idle. Send backups somewhere else too.

## Settings in `.env`

| Setting              | What it does                                                        |
| -------------------- | ------------------------------------------------------------------- |
| `SESSION_SECRET`     | Signs sign-in cookies. At least 32 characters. Keep it secret.      |
| `POSTGRES_PASSWORD`  | The database password. Only Mise uses it.                           |
| `MISE_VERSION`       | Which release to run: `2` for the newest 2.x, or an exact version   |
| `PORT`               | The port Mise answers on. Default `3000`.                           |
| `HTTPS_PORT`         | The port HTTPS answers on, once turned on. Default `3443`.          |
| `OUTSIDE_ACCESS`     | `approved` (default), or `open` as a way back in                    |
| `SETUP_TOKEN`        | The setup code. Empty: made up, asked only from outside the network |
| `MISE_DOMAIN`        | Your domain name, when Caddy from the compose file does HTTPS       |
| `COMPOSE_PROFILES`   | `https` to start Caddy with Mise                                    |
| `COOKIE_SECURE`      | `true` when Mise is only reached over HTTPS                         |
| `TRUST_PROXY`        | `1` behind Caddy. Your own web server: name it in Settings instead  |
| `MISE_BIND`          | `127.0.0.1` behind a proxy on the same machine                      |
| `ONEDRIVE_CLIENT_ID` | Your own Microsoft app for OneDrive backups. Empty uses Mise's own  |

## Development

Needs Node 24 or newer (or Node 22 with npm 11), and Docker for the development database.

```bash
npm install
npm run db:up
npm run dev
```

The API runs on port 3000 and the web app on 5173, with `/api` passed through to the API. In
production the server serves the built web app itself.

`npm run db:up` starts only the database, on port 5433 so it doesn't clash with a Postgres already
on the machine. `docker compose up -d` in this folder builds and runs the whole app from source on
port 3000, so don't run it at the same time as `npm run dev`.

| Command               | What it does                                |
| --------------------- | ------------------------------------------- |
| `npm test`            | All tests                                   |
| `npm run test:e2e`    | The browser tests, against the built app    |
| `npm run typecheck`   | Type-check every package                    |
| `npm run lint`        | ESLint                                      |
| `npm run format`      | Prettier                                    |
| `npm run db:generate` | Write a migration after changing the schema |
| `npm run db:studio`   | Browse the development database             |

The browser tests drive the built app (`npm run build` first) in Chromium, against a database they
empty each run: `E2E_DATABASE_URL`, by default `postgres://mise:pw@localhost:5434/mise_e2e`. Install
the browser once with `npx playwright install chromium`. They also run on every pull request.

Server tests run against PGlite, Postgres compiled to WebAssembly, so they need no database
running.

| Folder               | What's in it                                                  |
| -------------------- | ------------------------------------------------------------- |
| `packages/domain`    | Units, scaling, allergens and recipe trees                    |
| `packages/contracts` | Request and response schemas shared by the server and web app |
| `Server`             | The API, database schema and migrations                       |
| `Client`             | The web app                                                   |
| `deploy`             | What a kitchen downloads: compose file, Caddyfile, installer  |

### Without Docker on Windows

Docker Desktop on Windows needs the Windows Subsystem for Linux. Until that's set up, you can develop
against a Postgres installed directly on the machine. Create the role and database once:

```bash
psql -U postgres -c "create role mise with login password 'mise' createdb;"
psql -U postgres -c "create database mise owner mise;"
```

Then skip `npm run db:up` and run `npm run dev`.

## Releasing

Set the new version in the root `package.json`, add a section for it to `CHANGELOG.md`, and push a
tag such as `v2.0.1`. GitHub Actions runs the checks, builds the image for x86 and ARM, publishes it
to `ghcr.io/sandslidestudio/mise-kitchen` and creates the release from the changelog.

## Security

See [SECURITY.md](SECURITY.md) to report a problem privately.

## Licence

Mise is free software under the [GNU Affero General Public License v3.0](LICENSE). You can run it,
change it and share it. If you change it and let other people use your changed version over a
network, you have to offer them your source code too.
