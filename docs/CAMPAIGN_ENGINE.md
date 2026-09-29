# Campaign engine

Lost Tales Engine combines ordered prompts, character agents, a Game Master, and optional recorded checks. The world chooses which modules are enabled; dating and relationship systems are optional. This page describes the current `campaign-engine` branch, including the limits of its rules support.

## Set up a campaign

Create or edit a world in **Worlds**. Its **Overview** selects modules for campaign rules, relationships, dating, Visual Novel presentation, and world simulation. **Story Rules** sets a ruleset name, guided or mechanical resolution, a check resolver, sheet fields, moves, optional fixed targets, and a rank ladder. A campaign file can be imported or exported between installs.

Available presets are starter PbtA-style 2d6 moves, D&D 5e SRD 5.2.1 core checks, Starfinder 2e core checks, Fate Core skill checks, and generic 3d6 roll-under checks. They provide editable fields and core check resolution. They do not bundle complete published rulebooks, combat, classes, spells, or resource systems. You can name any custom ruleset and use it in guided mode.

In **Cast → Sheet**, assign stats and a rank to a character for a world. A character can keep multiple world-specific sheets; changing the active world does not overwrite the others. A move reads its linked sheet field. If a character has no sheet, the player can enter the modifier for that check. If the character has sheets but none for this story's world, the player must add the matching sheet before rolling.

## Resolution and the GM

Choose the **Game Master** turn policy in the scene. The GM judges declared actions, narrates public results, sets pacing, and selects which non-player characters act next. It sees public context, not another character's private prompts or memory, and it does not speak for the player character.

- **Guided mode:** the ruleset informs GM judgment. The result is labeled as judgment; no die roll or mechanical tier is claimed.
- **Mechanical mode:** the player resolves a move. The server rolls and stores the dice, sheet-derived value or entered modifier, target, and outcome on the player's turn before GM narration. A recorded miss binds the GM: model text cannot convert it into success. Without a recorded roll, the GM can only ask for one, not claim a mechanical result.

The rank ladder gives the GM context for what should be routine, uncertain, or out of reach at a character's standing. Rank guidance is not a replacement for a recorded check. The GM can propose lasting world facts, which require player confirmation; confirmed facts become shared canon. Branch consequences belong to their scene history, so rewinding or forking does not carry later branch events backward.

## Prompts and characters

Worlds and characters store ordered, enabled prompt items. The TavernAI 2 card importer retains the prompt tree's order. Unsupported activation or replacement rules and executable macros are imported disabled for review. Imported text is story data, not instructions to the engine. The Prompt Inspector shows the assembled request.

In a group scene, each speaking character receives its own card prompts, private lore, and private memory. Other participants contribute their names and public transcript only. A character can override the configured hosted model on the same provider. The GM uses the configured global model.

## Related play features

Stories contain numbered scenes. Ending a scene records a recap and opens the next; a separate playable Chapter layer is not yet stored. Scene scenery can be chosen from a world's places or uploaded art, with day and night variants. A pinned location stays until **Follow the story** returns control to story tags. Its choice follows branch history.

Visual Novel play uses character sprites, expressions, outfits, and optional VRM models. Stage controls are in a collapsible side rail. The adjustable desktop stage area supports moving characters; mobile emphasizes the current speaker. World clock and dating controls appear only when their modules are enabled.

The separate **Writer's Room** can search saved worlds, cast, lore, stories, goals, and facts locally for relevant context. Its guided builder creates a new world, cast, rules, and first scene from a reviewed draft. It can prepare a reviewed update to an existing character and sheet. It does not yet offer the same conversational edit flow for existing worlds or lore.

## Current limits and next work

- The mechanical presets cover core checks. Hit points, spell slots, combat turns, and other system-specific resources are not enforced.
- Guided mode is narrative guidance, including when a named ruleset has no mechanical adapter.
- Player confirmation is required for new shared world canon. Branch consequences remain on their branch.
- The GM uses the global model; separate GM provider credentials are not available.
- Structured character beliefs separate from campaign facts remain future work. Hearing a rumor should not automatically make it world truth.
- Playable Chapters and conversational updates to existing worlds and lore remain future work.

Personal worlds, characters, stories, and art live in the git-ignored `data/` folder or under `LOST_TALES_DATA_DIR`. Back up that folder separately from the source repository.
