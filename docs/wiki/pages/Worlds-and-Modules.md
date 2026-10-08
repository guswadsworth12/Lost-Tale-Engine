# Worlds and modules

A world holds the setting, rules, reusable scenery, lore, and optional systems for stories set there. Create one in **Worlds**, or start from the bundled Hollowmere Station world. A template supplies initial choices; **Overview → World modules** is where you adjust them.

![The Hollowmere world's Overview tab: the template choice and the World modules, with Guided outcomes, Relationships, Visual novel presentation, and World simulation on](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-world-modules.jpg)

## Choose the world tools

| Module | Adds |
| --- | --- |
| Story rules | Ruleset, moves, character-sheet fields, and guided or recorded outcomes |
| Relationships | Connections and relationship details |
| Dating tools | Dates, gifts, intimacy choices, and related CG unlocks |
| Visual novel presentation | Stage presentation, backgrounds, and layouts |
| World simulation | Clock, calendar, schedules, weather, and scene flags |
| Deep Memory | Recall guided by strong feelings, familiar places, and often remembered moments |

The editor's sidebar (**Overview**, **Story Rules**, **Canon**, **Locations**, **Simulation**, **Relationships**, **Presentation**, **Advanced**) shows a module's tabs only when the module is enabled. Turning a module off preserves its settings for later. A Dating Sim template emphasizes romance; other worlds can leave it natural or turn dating off. Your world can combine modules independently of its starting template.

## Deep Memory

**Deep Memory** is off by default in every template. Enable it under **Overview → World modules**, with **Character memory** on in Settings → Generation. Memories that felt strongly to the speaking character, happened in the current place, or have often come back to them get more pull when the memory budget is tight. Older memories without a recorded place still work.

The scene's current place follows moves on this story branch. New memories record where their source message happened, even while Deep Memory is off, so enabling it later can use those places. Characters still recall only what they witnessed or were told in the current branch. The 350-token memory budget stays the same, including the existing exception for pinned memories.

After a saved reply, the engine remembers which memories that speaker was given. This uses no extra model calls. Frequent recall gradually loses its extra pull over time when a memory is not recalled again. **Inspect prompt & memory** shows **Strong feeling**, **Happened here**, and **Often remembered** alongside the existing reasons.

Forgetting a memory or permanently purging its scene removes its recall history. Rewind undoes the recalled turns too; forks and full backups keep the history that belongs to their memories. Turning Deep Memory off returns to ordinary ranking and keeps recorded places and recall history for later.

## Build in a useful order

1. Write a short **Overview** with what players can do and who the cast is.
2. Set **Story Rules** before creating sheets if rolls matter.
3. Add **Canon** and **Locations**; keep player-visible facts separate from GM-only secrets.
4. Enable **Simulation**, **Relationships**, and **Presentation** only if the story uses them.
5. Open **Advanced** for prompt items and export/import options when needed.

Locations can have day/night backgrounds and music. A scene can pin scenery or **Follow the story** again. **Built-in places** offers stock place names (**Adventure**, **Modern school**); choose **My places only** to list just the world's own.

![The Locations tab of Hollowmere showing its four backgrounds](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-world-locations.jpg) Test a new world with a short story and inspect the assembled prompt before building many assets.

See [World Packs](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/World-Packs) for sharing a reusable world without play history.
