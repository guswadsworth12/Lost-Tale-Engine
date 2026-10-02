# Ruleset builder

**Worlds → Story Rules** defines a campaign's check resolver, sheet fields, moves, target rules, rank ladder, and tracked state. Start with a preset or a custom ruleset; import and export campaign files when you need to move the rules between worlds.

![Story rules editor showing move outcomes](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/lost-tales-story-rules.jpg)

## Start from a preset

Available starter presets cover PbtA-style 2d6 moves, D&D 5e SRD 5.2.1 core checks, Starfinder 2e core checks, Fate Core skill checks, and generic 3d6 roll-under checks. They are editable check foundations. Full combat, class, spell, and published resource systems are not bundled.

1. Select **Guided outcomes** or **Roll for outcomes** in the world's Story rules module.
2. Define each sheet field in **Character sheet builder** and link a field to each move that uses it.
3. Give a move its outcome text and optional effects on resources, conditions, clocks, or items.
4. Set a fixed target when the world always uses one. Otherwise the GM sets the target before asking for a roll, or the player enters it for a self-started move.
5. Save a matching world-specific sheet in **Cast → Sheet**, then test a roll in a story.

## Declare a different system

In **Writer's Room**, ask to make a ruleset and describe dice, success thresholds, and moves. A draft can use fixed dice, sheet-based pools, keep-highest/lowest, exploding or wild dice, success counts, and result or margin ranges. Each result must map to strong, mixed, or miss. The test bench rolls a sample action and previews the exact result given to the GM; invalid or uncovered outcomes must be fixed before applying. Applying keeps a history so the previous rules can be restored.

The recorded result binds narration in mechanical mode. See [Game Master and Rolls](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Game-Master-and-Rolls).
