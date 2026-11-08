# Changelog

Every release of Mise, newest first. Versions follow [semantic versioning](https://semver.org):
a change in the first number means you should read these notes before updating.

## 2.2.3

Fixes for tablets and phones, and a calmer interface that reads as made for a kitchen.

**Fixes**

- The recipe editor shows the names of what goes in on a 10-inch tablet again. "The rest" moves
  below the lines until the screen is wide enough for both.
- The top bar fits on a 1024 px tablet. On phones, the top bar and the Settings tabs fade at the
  edge when there's more to scroll to, and no page scrolls sideways any more.
- Settings → Connection no longer shows empty brackets after a restart.
- The backup warning names the day of the last backup, such as "No backup since Tuesday 3
  November", instead of a number of days that could be wrong.

**A calmer interface**

- Buttons, navigation and labels use normal capitals. Capitals stay where they mark something:
  station and course bands, allergens, codes and printed sheets.
- On Today, each line has one clear action: **Start**, **Stop** on your own line, or **Take over**
  on someone else's. The recipe is a link and removing is a plain ×. Lines nobody has claimed no
  longer say "Anyone".
- Sign-in and setup lose the drafting grid, corner marks, arrows on buttons and small labels above
  headings.
- Empty fields look empty. Examples moved to a hint under the field, or start with "e.g.".
- Pages and lists no longer slide in. Movement stays only where it answers what you did: the tick, a
  wrong PIN, starting a line.
- The upgrade test covers 2.2.2.

## 2.2.2

Printed prep lists and recipe cards, a safer PIN, offline that holds up better, and every fix
from a full review of the code.

**Before updating**

- On rootless Docker, Podman or Docker Desktop, tablets on the kitchen network may now be asked
  to request access once (see Security below). To skip that, an administrator can switch it off
  under **Settings → Connection** before or after updating.

**Printing**

- **Print** on Today prints the prep list: only what is still to do, grouped by station, each line
  with how much to make and a box to tick. Ticked lines stay off it, to save ink on a list some
  kitchens print every day.
- **Print recipe card** on a recipe prints it as a card to laminate and keep at the station: what
  it makes, how long it keeps, allergens, what goes in and the method, always at its written size.
- Fix: printing a recipe could give a blank page.

**Signing in**

- A PIN keeps everyday rights: a chef signed in with a PIN can do everything in the kitchen, but
  staff, devices, the connection and backups need a password sign-in. Settings shows those greyed
  out, with a note saying so.
- Five wrong PINs lock that person on every tablet, not just one, for 15 minutes; each lock after
  that lasts twice as long, up to a day.
- Signing out works offline: the tablet is signed out at once, and Mise hears about it as soon as
  it answers.
- Reloading just after signing in no longer sends you back to the sign-in page.

**When the network drops**

- What goes into a recipe, changed offline, shows at once, and a dish put on a menu offline shows
  on it. Allergens and dish cards that change with it say they update once the change is sent.
- Every recipe opens for editing offline.
- Fix: a tablet that reloaded twice while Mise couldn't be reached lost what it had saved.
- A change Mise keeps failing on no longer holds up the others: it is tried again a few times, then
  set aside with **Try again** and **Let it go**.
- A change sent twice at once, from two tabs or a resend, is made once.
- When the same thing was changed on another device, the side-by-side view is in your language,
  with stations, dishes, amounts and steps as you know them.
- Pages show what the device kept instead of "Couldn't load this" when only the refresh failed.
- A scaled recipe offline shows the amounts asked for, worked out on the device, never other ones
  under that label.

**Recipes**

- A sub-recipe in a kind of unit its yield can't be turned into (ml of a sauce that makes 1 kg) is
  refused when saving, with a message naming both, instead of breaking the dish later.
- Allergens that can't be worked out are an error, never a shorter list.
- Two cooks adding the same prep line at the same moment both count.

**Security**

- The kitchen certificate authority, when made from this version on, can vouch only for the kitchen
  network, so a tablet that trusts it trusts it for no other website. One made before keeps
  working, so no tablet has to trust it again.
- When Docker relays every visitor itself (rootless Docker, Podman, Docker Desktop, or IPv6 without
  an IPv6 network), Mise can't tell the kitchen from the internet. Those visitors now count as
  outside: each device asks for access once, and setup asks for the setup code. **Settings →
  Connection** says when this happens, with the fix, and can count them as inside again if Mise
  can't be reached from the internet. A web server you trust on the same machine works as before.
- The saved NAS password only goes to the server it was saved for.
- Changes are only accepted from Mise's own page.
- On its own domain, Mise tells the browser to stay on HTTPS.
- Backup errors no longer show addresses or ports in the browser.
- A device's data and photos are cleared when its session or access ends.
- A cook can't take someone else's name off a prep line.
- One address can keep only three access requests waiting, and a full list drops the oldest.

**Also**

- A tablet left open across an update offers a reload, and a page whose code is gone after an
  update says so instead of an error.
- A red dot on Settings, and a line on Today, while a device outside the kitchen waits for access.
- About forty more messages from the server are now in your language.
- The upgrade test covers 2.2.1.

## 2.2.1

- **New dish** on the Dishes tab no longer opens the editor under Recipes. Dishes have their own
  pages under Dishes: the new dish, its recipe, its editor and its print page, with the Dishes tab
  marked throughout.
- The Recipes editor makes preps and components only. A dish can no longer be made there, and a
  prep or component can't be turned into a dish, or the other way round.
- Links to a dish under Recipes, from bookmarks or older pages, open the same page under Dishes.
- Back from a dish's recipe or print page goes to the dish's card.
- The upgrade test now covers 2.2.0 as well.

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
