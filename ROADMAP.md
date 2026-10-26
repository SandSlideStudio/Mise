# Roadmap

What's planned after 2.1, roughly in order. Nothing here has a date.

- **2.1.1: Security and safer updates.** From an independent audit.
  - Dependencies updated past the published advisories (zod, fastify and three indirect ones).
  - Wrong passwords or PINs lock out the address they come from, not the account, so nobody can
    keep an administrator locked out by guessing. Many failures from many addresses still lock
    the account.
  - Setup without a code only works from the kitchen's own network. A request from the internet,
    or one that came through a proxy, needs the code Mise prints in its log.
  - A backup is made on the server before any database change when Mise updates.
  - An automatic upgrade test for every released version: a database from 1.0, 1.1, 2.0 and 2.1,
    filled with data, upgraded to the newest and checked.
  - The installer and its files come from the latest release instead of the `main` branch.
- **2.2.0: Temperature and cooling logs.** HACCP records kept on the tablet instead of on paper.
- **2.3.0: Costing.** Ingredient prices and purchase units, and a food cost per dish and per
  menu.
- **Labels.** Print prep date, use-by and allergens to a label printer when a line is ticked.
- **Par levels.** Record what's already made, so the prep list only asks for the rest.

Not planned: shared recipe libraries across several restaurants. That only makes sense once a
second site exists.

Ideas and requests are welcome as issues.
