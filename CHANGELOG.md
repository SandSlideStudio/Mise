# Changelog

Every release of Mise, newest first. Versions follow [semantic versioning](https://semver.org):
a change in the first number means you should read these notes before updating.

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
