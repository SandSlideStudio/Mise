# Roadmap

What's planned after 2.0, roughly in order. Nothing here has a date.

- **2.1.0: Setup, backups and the version.**
  - First-run setup offers an optional PIN for the person setting up the kitchen, so they can
    tap in on the kitchen tablet like everyone else without setting one later.
  - First-run setup offers an optional step to send backups to a NAS or OneDrive, and the
    backups page warns while backups only live on the server itself.
  - Dishes no longer have a season. The dish card prints the menu the dish is on instead: the
    menu being printed when cards come from a menu, otherwise the active menu it's on.
  - Everyone can write, change and remove the handover note, cooks included. The note gets an
    "X" next to its change button to remove it in one go instead of emptying the text.
  - Settings shows which version of Mise is running, and tells administrators when a newer
    one is out, with a link to what changed and the steps to update for their kind of install:
    TrueNAS, the installer or plain Docker. The check asks GitHub once a day and can be switched
    off.
- **2.2.0: Costing.** Ingredient prices and purchase units, and a food cost per dish and per
  menu.
- **2.3.0: Temperature and cooling logs.** HACCP records kept on the tablet instead of on paper.
- **Labels.** Print prep date, use-by and allergens to a label printer when a line is ticked.
- **Par levels.** Record what's already made, so the prep list only asks for the rest.

Not planned: shared recipe libraries across several restaurants. That only makes sense once a
second site exists.

Ideas and requests are welcome as issues.
