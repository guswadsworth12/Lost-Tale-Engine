# Campaign engine

Lost Tales Engine combines ordered prompts, character agents, a Game Master, and optional recorded checks. The world chooses which modules are enabled; dating and relationship systems are optional. This page describes the current `campaign-engine` branch, including the limits of its rules support.

## Set up a campaign

Create or edit a world in **Worlds**. Its **Overview** selects modules for campaign rules, relationships, dating, Visual Novel presentation, and world simulation. **Story Rules** sets a ruleset name, guided or mechanical resolution, a check resolver, sheet fields, moves, optional fixed targets, and a rank ladder. A campaign file can be imported or exported between installs.

Available presets are starter PbtA-style 2d6 moves, D&D 5e SRD 5.2.1 core checks, Starfinder 2e core checks, Fate Core skill checks, and generic 3d6 roll-under checks. They provide editable fields and core check resolution. They do not bundle complete published rulebooks, combat, classes, spells, or resource systems. You can name any custom ruleset and use it in guided mode.

### Your own game system

A system the presets don't cover can be declared instead: ask Writer's Room to "make a ruleset", or describe its dice ("roll d6 pools, take the highest; 6 is a full success, 4–5 partial, 1–3 bad"). The declared format covers:

- dice: a fixed count or a pool from the sheet value, keep highest or lowest, exploding dice, a wild die, and counting successes against a target number;
- outcomes: ranges of the result, or of its margin over a difficulty the GM sets before the roll, optionally with a "two or more dice on their highest face" critical;
- the stats and moves that go with it.

Each outcome counts as strong, mixed, or miss, so a recorded roll binds the GM, move effects change tracked state, and choice and question holds apply exactly as with the built-in resolvers. A ruleset that leaves any result without an outcome, or can't be rolled, can't be saved; the draft names what to fix. Before applying it, the draft's test bench rolls a sample action and shows the outcome and the exact line the GM receives, and can run it past the GM model. Applying it to a world keeps what it replaced, so it can be undone.

In **Cast → Sheet**, assign stats and a rank to a character for a world. A character can keep multiple world-specific sheets; changing the active world does not overwrite the others. A move reads its linked sheet field. If a character has no sheet, the player can enter the modifier for that check. If the character has sheets but none for this story's world, the player must add the matching sheet before rolling.

## Resolution and the GM

Choose the **Game Master** turn policy in the scene. The GM judges declared actions, narrates public results, sets pacing, and selects which non-player characters act next. It sees public context, not another character's private prompts or memory, and it does not speak for the player character.

- **Guided mode:** the ruleset informs GM judgment. The result is labeled as judgment; no die roll or mechanical tier is claimed.
- **Mechanical mode:** the player resolves a move. The server rolls and stores the dice, sheet-derived value or entered modifier, target, and outcome on the player's turn before GM narration. A recorded miss binds the GM: model text cannot convert it into success. Without a recorded roll, the GM can only ask for one, not claim a mechanical result.

The rank ladder gives the GM context for what should be routine, uncertain, or out of reach at a character's standing. Rank guidance is not a replacement for a recorded check. The GM can propose lasting world facts, which require player confirmation; confirmed facts become shared canon. Branch consequences belong to their scene history, so rewinding or forking does not carry later branch events backward.

## Tracked state

**Story Rules → Tracked state** defines what play keeps count of: resources (a number, optionally capped), conditions (on or off), clocks (segments that fill, optionally emptied at each new scene), and item lists. Any of them can be kept per character, and any can be hidden from characters so only the GM sees it. The starter moves include a small sample: Hurt, Supplies, and a Trouble clock.

Each move can say what each result changes and what each option costs when a result asks the player to choose, written in a short form such as `Supplies -1, Hurt on, Trouble +1` or `Gear + rope`. Set events take the same field; a set event without one applies any condition its consequence names ("Bea is hurt"). The server records a roll's changes with its dice, so a repeated submission cannot apply them twice, and model prose cannot change them. The GM can propose other changes (`Hurt on for Bea`); they apply only after the player confirms them, and can be corrected first.

Changes are stored on the messages that caused them, so rewinding or forking restores the state at that point. Ending a scene carries the state into the next one. The GM sees every tracked value; each character sees the shared values that aren't GM-only, plus their own. The Story panel's **State** tab shows current values and recent changes, and lets the player correct them.

## Prompts and characters

Worlds and characters store ordered, enabled prompt items. The TavernAI 2 card importer retains the prompt tree's order. Unsupported activation or replacement rules and executable macros are imported disabled for review. Imported text is story data, not instructions to the engine. The Prompt Inspector shows the assembled request.

**Writer's Room → Tune prompts** shows every prompt that drives a world's play:

- the engine's GM style, memory scribe, scene and chapter recaps, and character journals;
- the world's GM notes;
- the world's and its cast's prompt items.

For the engine's prompts, only their guidance can be changed. The data they are given, the reply format the engine reads, and the guardrails stay in place, and the editor shows the guardrails locked: player agency, characters with cards played only by their own agents, binding recorded rolls, and knowledge boundaries. An edit can be typed or proposed by the assistant with its reasoning, reviewed as a diff, and previewed on a sample turn from the world's latest scene before it is applied. Every applied change is kept in a history and reverts in one click. Tuning is per world, and travels in world packs as its own option.

In a group scene, each speaking character receives its own card prompts, private lore, and private memory. Other participants contribute their names and public transcript only. A character can override the configured hosted model on the same provider. The GM uses the configured global model.

## Related play features

Stories contain chapters, and chapters contain numbered scenes. Ending a scene records a recap and opens the next. Ending a chapter, from the same dialog, records a reviewable chapter recap and its open threads and opens the next chapter with an optional name and goal. The Game Master hears an ended chapter as its recap and steers toward the current chapter's goal; characters still hear only the scenes they were in. Stories made before chapters read as one first chapter. Scene scenery can be chosen from a world's places or uploaded art, with day and night variants. A pinned location stays until **Follow the story** returns control to story tags. Its choice follows branch history.

Visual Novel play uses character sprites, expressions, outfits, and optional VRM models. Stage controls are in a collapsible side rail. The adjustable desktop stage area supports moving characters; mobile emphasizes the current speaker. World clock and dating controls appear only when their modules are enabled.

**Picture this**, on a message or in the scene's tools, makes a picture of what happened: a moment, a background for the current location, or a portrait of someone present. Its prompt is drafted for free from the line, the location and time of day, how the cast looks now (outfits and forms included), and the world's art style. A moment starts with everyone present in the picture, your own character included; untick anyone to leave them out, or turn off **Include everyone in the scene** (Settings → Images) to start with just the speaker. Their portraits can be sent along so they look like themselves. The story model can improve the draft, or do so automatically when the dialog opens (Settings → Images). Moments show under their message, full-bleed on the Visual Novel stage, and in the Gallery's **Story moments** tab, grouped by story, chapter, and scene, with **Go to moment**. A background is also offered to the world, and a portrait to the character; replacing either asks first. Deleting a scene for good deletes its moments.

The separate **Writer's Room** can search saved worlds, cast, lore, stories, goals, and facts locally for relevant context. Its guided builder creates a new world, cast, rules, and first scene from a reviewed draft. It can prepare a reviewed update to an existing character and sheet. It does not yet offer the same conversational edit flow for existing worlds or lore.

## Current limits and next work

- The mechanical presets cover core checks. A world can track its own resources, conditions, and clocks, but hit points, spell slots, combat turns, and other system-specific rules are not built in.
- Guided mode is narrative guidance, including when a named ruleset has no mechanical adapter.
- Player confirmation is required for new shared world canon. Branch consequences remain on their branch.
- The GM uses the global model; separate GM provider credentials are not available.
- Structured character beliefs separate from campaign facts remain future work. Hearing a rumor should not automatically make it world truth.
- Conversational updates to existing worlds and lore remain future work.

Personal worlds, characters, stories, and art live in the git-ignored `data/` folder or under `LOST_TALES_DATA_DIR`. Back up that folder separately from the source repository.
