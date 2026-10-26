# Roadmap

What's planned after 2.0, roughly in order. Nothing here has a date.

- **2.0.1: Fixes.**
  - First-run setup only asks for a setup code when `SETUP_TOKEN` is set, or when Mise sits
    behind HTTPS or a proxy and so may be reachable from the internet. The hint stops naming a
    command that only works with the installer's folder.
  - The recipe editor hides the batch fields when a recipe is a dish: one batch makes,
    portions, prep minutes, keeps hours and storage.
  - The backups page stops assuming an SD card. Backups kept on the server go when the server
    goes, whatever it stores them on, so the advice to download one now and then says that in
    every language.
- **2.1: Costing.** Ingredient prices and purchase units, and a food cost per dish and per menu.
- **2.2: Temperature and cooling logs.** HACCP records kept on the tablet instead of on paper.
- **Labels.** Print prep date, use-by and allergens to a label printer when a line is ticked.
- **Par levels.** Record what's already made, so the prep list only asks for the rest.

Not planned: shared recipe libraries across several restaurants. That only makes sense once a
second site exists.

Ideas and requests are welcome as issues.
