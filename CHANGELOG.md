# Changelog

Every release of Mise, newest first. Versions follow [semantic versioning](https://semver.org):
a change in the first number means you should read these notes before updating.

## 2.2.0

Reach Mise safely from anywhere, set HTTPS up from inside the app, and keep working when the
network drops.

**Before updating**

- The install now publishes port **3443** too, for HTTPS. If something else on the machine uses
  it, set `HTTPS_PORT` in `.env` to a free port. On TrueNAS, add `- '3443:3443'` under the app's
  `ports` when you want HTTPS.
- From outside the kitchen network, Mise now answers only devices you approve (see below). Phones
  that reach Mise over the internet today ask for access once after the update. On a server with
  no kitchen network, approve the first one from the server itself: open Mise on your phone, ask
  for access, and run `docker compose exec app node Server/dist/index.js approve-device <code>`
  with the code your phone shows, inside the `mise-kitchen` folder.
- Kitchens that start Caddy with `--profile https` get `COMPOSE_PROFILES=https` added to `.env` by
  the installer, so Caddy comes along on every update.

**From outside the kitchen**

- From outside the kitchen network or VPN, Mise shows only a page to ask for access, not even the
  sign-in, until a chef or administrator approves that device under **Settings → Devices**. The
  device asking shows a short code, and the request shows the same code, so the right device gets
  in.
- Approving works from the kitchen, or from a device already approved, with your password again.
  An approval lasts until it's revoked or the device goes 90 days unused.
- A server with no kitchen network approves the device that sets it up or restores a backup.
- **Settings → Connection** names the one domain that leads to Mise from outside. The bare IP, or
  another site's name on the same server, then finds nothing.
- The **Tablets** tab in Settings is now **Devices**.

**HTTPS from Settings → Connection**

- **On the kitchen network:** Mise makes a certificate of its own for the addresses your tablets
  use. A new **/trust** page walks each tablet through trusting it once, with steps for iPad and
  iPhone, Android, Windows and Mac, and checks it worked. No domain or internet needed.
- **For your domain:** Mise gets a free Let's Encrypt certificate and renews it by itself.
- **Behind your own web server:** name the web server that passes your domain on (Apache with your
  websites, say), and Mise shows the lines to paste into it. It tells visitors at home from visitors
  outside through it, and keeps sign-in cookies to HTTPS when the visitor came over it.
- Certificates renew a month ahead; a failed renewal keeps the old one and says why.

**When the network drops**

- A tablet shows everything it had loaded, and loads the prep list, recipes, dish cards and menus
  in the background, so pages nobody opened yet work offline too. A bar says Mise can't be reached.
- Prep lines, ticks, the handover note and edits to recipes, menus and ingredients are kept on the
  tablet and sent in order once Mise answers. Each is made exactly once, however often the
  connection drops while sending.
- If someone changed the same recipe, menu or note meanwhile, both versions are shown side by side
  and you choose which stays.
- Over HTTPS, the app itself is kept on the tablet, so it opens with the server switched off, and
  Mise can be installed on the home screen.
- Things that need the connection say so, instead of "something went wrong".

**Dishes**

- Dishes have their own **Dishes** tab, between Recipes and Menus, and are no longer listed under
  Recipes. Each dish shows as the front of its card, grouped by course: the menu it's on, how it
  is served, its allergens and whether it's vegan.
- Find a dish, filter by course, see only the dishes on an active menu, or use **Free from** to see
  what an allergy table can have.
- A dish opens as its card on screen, front and back, with the same parts as the printed card, in
  the screen's language and colours. From there, open its recipe, edit it, or print it.
- In a kitchen that keeps dish cards to chefs and administrators, cooks still see the Dishes tab,
  and a dish opens its recipe for them.
- **New dish** on the Dishes tab starts the editor as a dish.

**Fixes**

- A menu whose dish cards were never downloaded no longer says its dishes changed since printing.
- The amount field when adding to the prep list is wide enough for its placeholder.
- The upgrade test now covers 2.1.1 as well.
- After a reload, what the tablet kept is refreshed at once instead of being trusted as current.

**Tests**

- Tests for the dish card, its PDF and the card on screen in the web app.
- Browser tests, run on every pull request against a real database: setup, the prep list, dishes,
  PIN sign-in on a tablet, outside access, offline use with a conflict, and kitchen HTTPS.
- The README has a guide for Oracle Cloud's free tier.

**Roadmap**

- Temperature and cooling logs and costing are moved back until there's been more research into
  the rules around them.

## 2.1.1

Security and safer updates, from an independent audit.

- Dependencies updated past the published advisories, among them zod (high) and fastify.
- Wrong passwords and PINs lock out the address they come from, for that account, instead of the
  account itself, so nobody can keep you out by guessing at your email from somewhere else. Thirty
  failures from any addresses within 15 minutes still lock the account. A new password or PIN from
  an administrator lifts every lock on that person.
- First-run setup without `SETUP_TOKEN` only skips the code for computers on the kitchen network.
  From a public address, or through a proxy or tunnel, it asks for the code Mise prints in its log.
  Restoring a backup on the setup page follows the same rule.
- Backups can go to a NAS and OneDrive at the same time: tick each place you want, both in setup
  and under **Settings → Backups**. They are always kept on the server too. If one place is down,
  the others still get the copy, and the failure is shown. A kitchen sending to one place keeps
  doing so after the update.
- Those places are connected during setup itself: test the NAS or sign in to OneDrive on the setup
  screen, before the kitchen is created, instead of on the backups page afterwards.
- Before an update changes the database, Mise backs the kitchen up on the server. If that backup
  fails, nothing is changed and Mise stops with a clear message.
- The installer and the files it downloads come from the latest release instead of the `main`
  branch, with SHA-256 checksums alongside. Install with
  `curl -fsSL https://github.com/SandSlideStudio/Mise/releases/latest/download/install.sh | sh`.
- Fixed: the installer stopped after starting Mise when run as `curl ... | sh`, before printing the
  setup link.
- Every released version is now upgraded to the newest in an automatic test, data included.

## 2.1.0

**Setup**

- Whoever sets up the kitchen can choose a PIN for themselves, so they can tap in on the kitchen
  tablet straight away.
- Setup asks where backups should go. Choose a NAS or OneDrive and Mise opens the backups page
  right after setup to connect it.

**Dish cards and menus**

- Dishes no longer have a season. The dish card says which menu the dish is on instead: the menu
  you're printing from, or else the active menus it's on. A kitchen that hid the season on its
  cards keeps the menu hidden.

**Handover note**

- Everyone can write, change and remove the handover note, cooks included. An "X" next to the
  change button removes it with a second tap.

**Backups**

- The backups page warns while backups only live on the server itself.

**Version**

- **Settings → Kitchen** shows which version of Mise is running. Once a day Mise asks GitHub whether
  a newer one is out and tells administrators, with a link to what changed and how to update on
  TrueNAS, with the installer or with plain Docker. Nothing about the kitchen is sent, and it can be
  switched off. A small dot on Settings shows when an update is waiting.

**Fixes**

- The check page in setup no longer shows an empty amount for a dish.

## 2.0.1

- First-run setup only asks for a setup code when one was set with `SETUP_TOKEN`, or when Mise
  runs behind HTTPS or a proxy and may be reachable from the internet. Then a code is always
  needed, and Mise prints one in its log if none was set. The hint no longer points to a command
  that only works with the installer.
- The recipe editor no longer shows batch size, portions, prep time, keeping time and storage for a
  dish. A new dish is written for one plate; existing dishes keep their size.
- The backups page no longer assumes an SD card.
- Mise runs as any user, such as the apps user on TrueNAS, and says clearly at start when it
  can't write its data folders.
- The database is no longer migrated twice every time Mise starts.
- The README explains installing on TrueNAS.
- Developing Mise needs npm 11, which comes with Node 24, so `npm install` no longer rewrites
  `package-lock.json`.

## 2.0.0

**Read this before updating.** Services and generated prep lists are gone. Every kitchen now
keeps one running prep list. A kitchen with `MISE_VERSION=1` in its `.env` stays on 1.x
until you change that line to `2`. Make a backup first.

**One prep list**

- Each kitchen keeps one running list. Lines go on by hand and come off when they're ticked or
  removed.
- When you update, open lines from today's and future services move onto the running list.
  Past services and their ticked lines are deleted.
- "Needs preparing" on ingredients and the choice between prep modes are gone.
- Backups made with 1.x still restore. Their service lines are left out.

**Adding from a recipe**

- While you type a prep line, matching recipes are suggested. A line added from a recipe links
  to that recipe, opened at the amount the line asks for.
- Adding something that's already on the list for the same station adds to that line instead
  of making a second one.

**Handover note**

- Chefs can leave a note at the top of the prep list for the next shift. It shows who wrote it
  and when. Clearing the text removes it.

**Menus**

- A new Menus page groups dishes into menus that are a draft, active or archived. Dishes are
  shown by course and can be reordered, and a menu can be copied for the next season.
- Each menu has an allergen overview: every dish against the 14 allergens and vegan, grouped
  by course. Print it or download it as a PDF, in any language and in day or night colours.
- Download all of a menu's dish cards as one PDF, in menu order. The menu shows which dishes
  have changed since its cards were last downloaded.
- Menus are part of every backup.
- When a kitchen keeps dish cards to chefs and administrators, cooks no longer see the buttons
  for them.

## 1.1.0

**Dish cards**

- Every dish has a dish card for front of house: the plating photo, season, flavour profile,
  serving temperature, place on the menu, components, drink pairings and cutlery on the front,
  and every allergen per component on the back.
- Print it, or download it as a PDF, in any of the five languages and in day or night colours.
- Anything sitting directly on a dish that brings an allergen gets a row of its own, so the
  table never leaves one out.
- Ingredients can say whether they are vegan, and which gluten cereals and nuts they contain.
  A card only calls a dish vegan when every ingredient in it says so.
- **Settings → Dish cards** sets the heading, logo, location, the kitchen's own warning in each
  language, which parts of the card show, the look, and who may open cards. The settings and the
  logo are part of every backup.

## 1.0.0 (first public release)

**Recipes**

- Recipes are specs: a yield, portions, method steps with timers, and components that are
  ingredients or other recipes, nested as deep as the kitchen goes.
- Scale a recipe by factor, to a yield or to a number of portions, all the way down the tree.
  Eggs round to whole eggs.
- The 14 EU allergens roll up through every sub-recipe, plus "may contain" on each recipe.
- Plating photos, and a print layout for the pass.

**Prep**

- Put dishes and covers on a service and generate one prep list per station. A sauce used by three
  dishes becomes one line at the summed quantity.
- Generating again merges into the list: hand-added lines and ticked lines are left alone.
- Or keep one running list instead, added to by hand. Ticked lines drop off after two hours.
- Mark a line "being made" so two cooks don't make the same thing.
- Every open screen updates as soon as someone ticks something.
- A tick made while the wifi is down is kept on the tablet and sent when it comes back.

**The kitchen**

- Managers sign in with email and password. Cooks tap their name and a PIN on a tablet an
  administrator has enrolled.
- English, Dutch, French, Spanish and German, chosen per kitchen and per person.
- Phone layouts for the prep list and recipes; day and night themes.
- A first-run setup that creates the kitchen, its stations, staff and first recipes in one go.
- A short tour of the app for each person the first time they sign in.

**Running it**

- One Docker image for normal PCs and ARM boxes such as a Raspberry Pi, and an installer that
  writes its own secrets.
- Optional HTTPS through Caddy.
- Nightly backups of the data and the photos, encrypted with a recovery key you print. Kept on
  the server, downloadable from Settings, and optionally sent to OneDrive, or to a NAS or Nextcloud
  over WebDAV.
  Administrators are warned when a backup fails or hasn't run for two days.
- A new server can be set up by restoring a backup instead of going through setup.
- Light enough for a Raspberry Pi Zero 2 W. The database is sized for small machines, the
  queries every tablet makes after a tick are prepared once, and logs, health checks and "last
  seen" times hardly write to the SD card. Old logs are dropped instead of filling the disk.
- The server refuses to start in production with the example secrets still in place.
- A new server can only be set up with the one-time code in the link the installer prints.
- Sign-in attempts are rate limited and lock an account after five wrong tries, even when
  they're sent all at once.
