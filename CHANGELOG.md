# Changelog

Every release of Mise, newest first. Versions follow [semantic versioning](https://semver.org):
a change in the first number means you should read these notes before updating.

## 2.4.0

Setup that knows about the checklist and PIN-only sign-in, a checklist that links to recipes and
prints, use-by labels, food cost, allergen records and a notice for guests, privacy controls for
staff data, and a stack of smaller fixes.

**Before updating**

- Tablets left open on 2.3 should be reloaded once the update is done, so they pick up the new
  app. Mise offers it on each of them.
- Food cost starts in euros with 9 % VAT on food. A kitchen elsewhere sets its own currency and
  rate under **Settings → Kitchen** (administrators).
- Each recipe's new "how it is kept" choice is filled in from its storage note. Worth a look before
  printing the first labels.
- Cooks now have the **Ingredients** tab, without prices and without editing, to check labels at
  delivery.
- Going back to 2.3 afterwards means restoring the backup Mise makes before it updates.

**Setup**

- Setup asks whether to use the prep checklist, sign-in with a PIN only, and how long a shared
  tablet may be left alone. With the checklist chosen, the next step lets you fill it in by
  station. With PIN-only chosen, it's on straight away, and setup refuses PINs that are the same
  or too easy to guess.
- The sign-in page and the tour follow the kitchen's choices: no "tap your name" in PIN-only mode,
  and the tour shows the checklist when it's on.

**The prep checklist**

- A checklist line can be linked to a recipe; the line it puts on the prep list then has the
  Recipe link, like one added from the book.
- A checklist line can have a **par**: how much the kitchen wants ready (3 l, 40 each). Adding it
  asks how much is already there, and the prep list only asks for the rest ("Make 1.8 l — par 3 l,
  1.2 l there"); a line with enough there isn't added at all. The recipe link opens the recipe at
  that amount.
- A par smaller than one batch of the line's recipe gets a gentle word under it ("Less than one
  batch (500 ml) — meant 1 l?"), for a unit left on ml by mistake. It still saves.
- **Print checklist** gives a sheet by station with a box per line, for kitchens that tick on paper,
  and each line's par with a box to write what's there.
- Ticking no longer makes the page jump: the "not sent yet" notice only shows once a tick has
  waited a second, at the bottom of the screen. Notices there stack instead of covering each
  other.
- Deleting a recipe that a checklist line links to no longer stops the next checklist save: the
  line simply loses its link, on every screen. A tablet that changed the checklist offline
  meanwhile asks which version to keep, instead of losing its change.

**Allergens**

- An ingredient can say what it **may contain**, as on the supplier's label ("may contain nuts").
  It carries through every sub-recipe into each dish, its card and the menu's allergen overview.
- Every dish keeps a record of its allergens: the dish page says when they last changed, and
  **History** shows each change, what caused it (an ingredient or sub-recipe that was edited) and
  who made it. The menu's allergen overview says which date its information is from.
- **Check label**, on each ingredient, and **Check a delivery** for several at once: set the
  allergens as the label in front of you says them, and before anything is saved Mise shows which
  dishes and menus that changes. A label that matches is one tap, and still recorded. Each
  ingredient says when its label was last checked and by whom. A change a cook finds waits for a
  chef to approve it; cooks now have the Ingredients tab for this, without prices and without
  editing. Works offline.
- A recipe with no lines of its own that declares an animal allergen (a bought-in prawn oil,
  say) now counts as not vegan, on its dish card row and in every recipe it goes into, instead
  of "not said". Found by checking thousands of made-up kitchens against a plain walk through
  each recipe.
- The dish card's allergen table always shows its **Other ingredients in the dish** row when
  something put straight on the dish, or declared on it, carries an allergen, with all of them.
  It used to leave the row off when a sub-recipe already had that allergen, so with butter on a
  dish whose jus has milk too, front of house reading "no jus" would have thought "no milk".
- **Print allergen notice** (on Dishes and the menu overview) gives a sheet for guests, A4 or A5,
  in the kitchen's language and English: "Allergies or intolerances? Ask our staff." In the
  Netherlands, allergens may only be told to guests by word of mouth when such a notice is up.

**Labels**

- A ticked prep line has a **Label** button, and every prep recipe can print labels by hand ("how
  many"): what it is, when it was made and by whom, until when it may be used, how it is kept and
  its allergens. It prints to the kitchen's label printer through the print dialog, on the roll
  chosen under **Settings → Kitchen → Label size**, and works offline.
- The use-by comes from the recipe's own shelf life. Without one, chilled prep gets the new
  Hygiënecode's default: until the end of the second day after it was made (the third when kept at
  4 °C or colder). Frozen or dry prep without a shelf life gets a line to write the date on.
- **Print a label when a line is ticked** (Settings → Kitchen, off by default) opens the print
  dialog straight away for lines that come from a recipe.

**How it is kept**

- A recipe says how it is kept: chilled at 7 °C or colder, chilled at 4 °C or colder, frozen, dry,
  or kept hot, with the old storage field kept as a note ("Labelled tubs, walk-in"). Updating fills
  it in from what the note already says ("Koelcel, 4 °C" becomes chilled at 4 °C or colder), so
  labels get their use-by from a choice rather than from reading the note. (A backup from before
  2.4, restored, leaves the choice empty; labels still read the note until one is made.)

**Food cost**

- An ingredient can have a purchase price, as on the invoice ("12.50 for a 5 kg bag"), and a trim
  yield. Mise works out what each recipe costs through every sub-recipe, per batch, per litre or
  kilo and per portion, and follows the size asked for.
- A dish can have a selling price: its page shows the cost per portion and the food cost %, worked
  out without VAT (an administrator sets the currency and the VAT rate on food under **Settings →
  Kitchen**). The menu page
  shows it for every dish, and the menu's average.
- An ingredient without a price is never counted as free: the cost says "so far" and names what is
  missing. A price older than six months says so.
- Costs are for chefs and administrators. Cooks never see a price, on any screen or tablet.

**Privacy**

- **Settings → Privacy** lists what Mise keeps about people, for how long, where backups go, and
  every outside connection it can make. The README has the same, under "What Mise stores and
  sends".
- **Settings → Staff → Their data** downloads everything Mise holds about one person, to read or
  as JSON. Removing someone now also clears their name from the handover note, and says plainly
  how long older backups keep their data.
- **Settings → Kitchen → Keep them for** sets how long kept prep lines stay. A kitchen set up on
  2.4 starts at a year; a kitchen that updates keeps them for good, as before, until an
  administrator chooses. A shorter time deletes older lines within the hour, so Mise asks first.
- Outside devices unused for 90 days are forgotten, with their address and browser, and old
  sessions lose their browser name. This clean-up now runs every hour, not only when someone opens
  the list.

**Smaller things**

- Passwords show and hide with an eye icon, in every password field.
- Settings remembers its tab in the address: a reload stays put and Back steps between tabs.
- A cook who opens a recipe or dish editor by its address sees that it's for chefs, instead of a
  form that can't be saved.
- Searching **Ingredients** works offline too, so a label at the back door can be found and checked
  with Mise out of reach. It said it couldn't load before.
- **Turn down all waiting** clears every outside device waiting to be let in, in one go.
- The footer links to "GitHub", and **Licences** next to it lists every open-source package and
  font that ships with Mise, offline too.
- A sous chef's **Staff** tab only offers what a sous chef may do: see the brigade, and download
  their own data.
- **Settings → Connection** says plainly that the web server Mise sees is a suggestion to check:
  any machine on the network can put itself forward.
- The Dutch, German, French and Spanish texts were gone over: one word for each kitchen term
  throughout, the same form of address everywhere, and a number of clumsy or wrong phrases fixed.
- Prices, amounts, yields, pars, VAT and every other number box take a decimal comma or a point,
  whatever language the browser is set to. An English browser read a purchase price of "9,80" as
  980, so every food cost was a hundred times out without a word. Something that can't be read,
  such as "1.250,50", is now pointed out under the box and nothing is saved until it is fixed.
  "1.250" on its own, a thousand or one and a quarter depending on who wrote it, is asked about.
  Every number shown is written the reader's way too, in the edit-conflict window and on the
  printed prep list as well.
- Units are named in the reader's language wherever they are shown, printed sheets included:
  "2 el" and "1 kopje" in Dutch, "2 EL" in German, "2 c. à s." in French, "2 cda." in Spanish,
  with "stuk" rather than "each" to choose from. Recipes keep the same units underneath, so a
  recipe written in one language reads right in another. g, kg, ml and l stay as they are.
- A recipe or dish with nothing in it yet shows no food cost, rather than €0.00. The purchase price
  and selling price boxes show the kitchen's currency sign beside them. Prep and component
  recipes no longer offer a plating photograph, which is for dishes (one already added still
  shows, so it can be removed). Setup says a password is too short once, not twice.
- An active menu with dishes still marked draft says so, on its page and in the list of menus
  ("2 dishes are still drafts — their cards say so"), and chefs can publish them from there in
  one tap.

**Accessibility**

- Every page is now checked automatically for accessibility, in day and night, on a computer and a
  phone, as a chef and as a cook, setup included. What the checks found is fixed: language buttons
  say what they show, the dish card's allergen table can be scrolled with the keyboard, the remove
  confirmation reads clearly at night, editors and pages have proper headings, and the tour keeps
  the keyboard inside it until it's closed.
- The prep list and the checklist can be used by keyboard alone, checked by tests.
- The small "Step 5 of 6" line in setup is easier to read.

**Security**

- A tablet that signs in by PIN alone now also locks after ten wrong PINs within 15 minutes,
  whatever right ones came in between. Before, someone could try four, sign in as themselves, and
  try four more, until a chef's PIN came up.
- Sign-in no longer tells a stranger which email addresses have an account: guessing at a made-up
  one now locks after the same number of tries as a real one.
- Giving someone a PIN no longer lets a chef find out other people's PINs one "already taken" at a
  time: after five, Mise asks them to wait.
- Turning PIN-only sign-in or idle sign-out on or off needs a password sign-in, like the other
  settings that decide who gets in.
- A recipe tree built to double at every level can no longer run the server out of memory; it is
  refused instead.
- A backup can no longer, once restored, make deleting a photo remove a file outside the upload
  folder, or unpack into more memory than a kitchen could ever need.
- A change resent with the same id as another one is no longer answered with that other one's
  result.
- Recipes built to be enormous can no longer make every tablet try to work out more than it can
  hold: past a sensible size, the longest specs are opened online instead of kept offline.
- One person can leave at most 50 label changes waiting for a chef, so a flood of made-up ones
  can't bury a real allergen change.
- Two changes to the kitchen certificate at the same moment (a second tab, or the nightly renewal)
  are made one after the other, so neither can undo the other.
- With `TRUST_PROXY` set, someone reaching Mise's own port through Docker's relay (IPv6, rootless
  Docker, Podman) could name a kitchen address in a forwarding header and count as inside. Only the
  web server named in **Settings → Connection** speaks for the relay now; Caddy from the compose
  file works as before.
- An outside device taken off the list stops hearing live updates at once, not only once its
  sign-in ends. One person can hold twenty live-update streams open at most.
- A kitchen certificate made before 2.2.2, which a trusting tablet would believe about any
  website, can now be replaced under **Settings → Connection** by one limited to the kitchen
  network. Settings says when yours is one; each tablet then trusts the new one once more.
- HTTPS no longer lets a request take forever to arrive, so nobody can hold connections open by
  sending one a byte at a time.
- The installer writes `.env` readable by its owner alone from the first byte, and runs nothing
  from a download that was cut off halfway.
- A cook ticking a line can no longer date the tick so far back that the line drops off the prep
  list at once (and, where ticked lines are deleted, is gone for good). A tick sent late keeps its
  own time up to an hour back, so the line stays on the list at least an hour for a chef to see
  and reopen.
- A shared tablet that signs out when left alone is now signed out by Mise itself as well, not only
  by the tablet's browser. A browser that was closed, put away or switched off no longer leaves the
  last cook signed in for whoever picks the tablet up. A tablet in use tells Mise so now and then,
  so nobody at work is signed out.
- From outside the kitchen, adding staff, changing someone's password, email, PIN or role or
  switching them off, and enrolling a tablet now ask for your password again, like approving a
  device. Before, a signed-in phone that went missing could add an administrator with a password
  of its choosing and let itself in as them.
- Changing your own password or email asks for your current password first, so someone at a
  session left signed in can't lock you out of your own account.
- Nobody can lift their own lock any more, not with "Lift the lock" and not by giving themselves a
  new PIN. Before, a signed-in phone that went missing could lift the lock after every five wrong
  passwords and keep guessing for as long as it liked. Another manager still can.
- From outside the kitchen, more now asks for your password again: lifting someone's lock,
  removing someone, turning down or taking back an outside device, revoking a tablet or lifting
  its lock, and everything in Settings → Connection: the address from outside, the web server
  Mise believes, counting relayed visitors as inside, and HTTPS. Before, a signed-in phone that
  went missing could tell Mise to count itself as inside and pass every other check.
- From outside the kitchen, the recovery key, downloading a backup, sending backups somewhere
  else (a NAS, OneDrive) or keeping fewer, and testing a NAS ask for your password again, and so do
  PIN-only sign-in and the idle sign-out for shared tablets. Before, a signed-in phone could carry
  the whole kitchen off, or switch the idle sign-out off and stay.

**Under the hood**

- Shipped dependencies are checked for known security problems on every change; a few were
  updated to fixed versions.
- Tablets load ahead for offline use far more lightly: they ask whether anything changed, and only
  then fetch the kitchen in one go, read once on the server and shared between tablets. Before,
  every tablet asked for every recipe several times over, every half hour. That one fetch sends
  each recipe once and lets the tablet work out the rest: for a kitchen of 250 recipes and 80
  dishes, about 110 KB instead of over a megabyte.
- What a tablet loaded ahead now stays on it for the week it is meant to. Before, a recipe or card
  nobody had opened was let go of after five minutes, so offline it often wasn't there. Changes
  not sent yet, or saved while loading, are never painted over by what was loaded, and cards a
  cook may no longer open are no longer kept.
- Restoring a backup no longer writes a readable copy of it to disk, and photos and database go in
  together: if a restore fails, the server is left exactly as it was. Leftovers of a restore cut
  short are cleared when Mise starts.
- Two people saving the same recipe, menu, ingredient or handover note at the same moment, or two
  administrators stepping down at once, are now caught inside the save itself, not only just
  before it.
- Removing someone also clears the answers Mise keeps for a week to repeat a write, where those
  name them.
- The upgrade test covers 2.3.1, and checks that ticked lines a kitchen keeps survive the update and
  a restore.

## 2.3.1

**Fix**

- After opening a recipe or a dish's recipe, the top bar and "← The book" did nothing: every
  click landed back on the recipe. They work again.
- The dish card had the same flaw for older links; it can no longer pull you back either.
- On a tablet that reloaded the dish card or the menu's allergen overview a few times, especially in
  several tabs, they could stop opening at all ("This page didn't open") until the browser's data
  was cleared. The fonts cards are drawn with were saved with the offline data and came back
  unusable; they're no longer saved, and updating clears a broken copy.
- A browser test now leaves every page every way (the top bar, back links, the browser's back
  button, the Settings tabs), as a chef and as a cook on a tablet, on a computer and a phone, and
  fails on any error in the browser. This kind of bug can't reach a release unnoticed again.
- The upgrade test covers 2.3.0.

## 2.3.0

A checklist so a cook can make an accurate prep list without remembering everything, sign-in by
PIN alone, and tablets that sign out by themselves.

**Before updating**

- Nothing changes until you choose it: the prep checklist, PIN-only sign-in and signing out
  untouched tablets are all off until switched on under **Settings → Kitchen**.

**The prep checklist**

- The chef keeps a list of what the kitchen makes, by station, and edits it any time from the prep
  list.
- Anyone, cooks included, ticks what's needed and taps **Add to prep list**. What's already on the
  list is skipped, and Mise says how many went on and how many were already there.
- It works offline: the lines show as waiting and go on once Mise answers, once.

**Who added a line**

- Every prep line says who put it there, and whether it came from the checklist.

**Sign in with a PIN only**

- Chosen under **Settings → Kitchen**: the tablet shows just a keypad, and the PIN finds the person.
- Every PIN must be different, and obvious ones (1234, 0000, 2580, 1122…) are refused. A head chef
  or administrator gives everyone with a PIN a new one; Settings lists who is still waiting, and
  tablets keep showing names until everyone is done.
- Five wrong PINs on a tablet lock that tablet for 15 minutes, then longer each time, up to a day.
  **Settings → Devices** shows the lock, with **Lift the lock**.
- Turning it off brings the names back.

**Shared tablets sign out by themselves**

- Choose under **Settings → Kitchen** how long a shared tablet may be left untouched, from 2 to 30
  minutes. A notice with **Stay signed in** comes 30 seconds before. Changes still waiting to be
  sent are kept for that person.

**Safer and sturdier**

- A photo or logo is checked by what the file is, not what it claims to be.
- A flood of access requests can no longer push a real one off the list: when 20 devices are
  waiting, new requests are turned away until a manager answers some.
- Two tabs saving a change offline at the same moment no longer lose one of them.
- The database itself now refuses two accounts with the same email in different capitals.
- The logo is drawn as SVG: sharp on every screen.
- The upgrade test covers 2.2.4.

## 2.2.4

Every fix from a second full review of the code: allergens shown right everywhere, no edit or tick
lost or overwritten unseen, and the security gaps it found closed.

**Before updating**

- The metric or imperial setting is gone: it was never used. So are trim yield, density and weight
  per piece on ingredients, which nothing used either. What was entered for them stays in the
  database, for when costing uses them.
- Turning on kitchen HTTPS for the first time now takes addresses and local names only, such as
  `192.168.1.50` or `mise.local`. A one-word name such as `truenas` is refused: type
  `truenas.local` or the address instead. A kitchen certificate you already have is unchanged.
- The installer checks every file it downloads against the release's checksums.

**Allergens**

- **Free from** leaves out dishes that may contain the allergen, not only those that contain it,
  and dishes whose allergens aren't all known yet.
- A dish or ingredient with milk, eggs, fish, crustaceans or molluscs is never shown as vegan, even
  if it was ticked as vegan. The ingredient form says when the two disagree.
- A recipe or ingredient changed on another tablet shows on every open screen at once.

**Nothing lost or overwritten**

- Editing an ingredient someone else changed meanwhile opens the side-by-side choice, as recipes and
  menus already did. Recipes and ingredients edited online get the same check, not only offline
  ones.
- Two edits to the same thing made offline no longer conflict with each other.
- Changes waiting on a tablet are kept while it waits to be let in again or for a password.
- A tick made offline keeps the time it was made, so the line drops off two hours after the tick
  and not after the wifi came back. A tick on a line added offline goes out right after the line.
- Ticked lines drop off by the server's clock, so a tablet with the wrong time doesn't matter.
- A web page in place of an answer, such as a hotel wifi login, counts as no answer; an error page
  counts as a refusal.
- When Mise answers with an error, the app opens from the tablet instead of the error page.
- Pointing at a station or recipe deleted meanwhile says it no longer exists.
- The conflict choice takes the keyboard focus, keeps Tab inside, and **Decide later** (or Escape)
  leaves it waiting in the notice at the top.

**Security**

- The "changes only from Mise's own page" check can no longer be skipped with an oddly written
  address.
- Before setup, a page opened on the kitchen network can't set Mise up under its own name: the
  setup code is needed unless Mise is reached by its address or a local name. The TrueNAS
  instructions now set a setup code. The NAS test during setup no longer tells a stranger why it
  failed.
- Signing in gives the same answer for an unknown email, an account that only has a PIN, and one
  that was switched off.
- The development compose file keeps the database on the machine itself and needs a password.
- Settings → Connection says when everyone coming through an untrusted tunnel counts as one
  visitor, so a few wrong passwords lock everyone out.
- A NAS address starting with http:// gets a warning that the password crosses the network
  readable.
- A release runs every check, browser tests included, and only the newest version becomes
  "latest" and "2".

**Smaller things**

- Managers can lift someone's lock under **Settings → Staff**, without a new PIN. A PIN lock now
  shows there too.
- Setup either happens completely or not at all, so a failed setup can simply be tried again.
- Backups are skipped again when nothing changed; a tablet being seen counted as a change.
  **Settings → Backups** warns when the disk is getting full.
- The app comes compressed, without its debugging files, and is kept by the browser between
  visits. A tablet keeps at most 300 photos.
- Buttons are at least 44 px tall on touch screens.
- A failed Let's Encrypt request says why instead of "Mise can't be reached", and the remaining
  English-only messages are translated.
- The dish card link no longer flashes for cooks in kitchens that keep cards to chefs.
- The upgrade test covers 2.2.3.

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
