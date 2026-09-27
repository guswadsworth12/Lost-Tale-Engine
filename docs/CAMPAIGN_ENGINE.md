# Lost Tales Engine: campaign engine direction

## What works today

- **Campaigns.** Create a world, open **Campaign**, and load the starter PbtA moves or import a campaign file (**Import / Export campaign file** moves a world's rules between installs). Each world switches between guided and 2d6 mechanical outcomes. Dating and relationship scoring are optional and off by default for campaigns.
- **Ordered prompts.** Worlds and characters carry ordered, enabled prompt items. The TavernAI 2 card importer reads a card's prompt tree in order; unsupported activation/replacement rules and executable macros are imported disabled for review, never executed. `{{this_card}}` is substituted with the character's name.
- **Character agents.** In a group chat each speaker's request carries only their own card prompts, private lore, and private memory; everyone else appears by name and through the public transcript. A hosted model can be overridden per character on the configured provider.
- **Game Master.** Choose the **Game Master** turn policy in the Scene panel. After each player turn the GM (`src/lib/world/gm.ts`) adjudicates the declared action in the campaign's mode, narrates the observable result, sets pacing, picks up to three characters to act in order, and proposes lasting changes. The engine validates the GM's decision: a recorded roll is binding whatever the model says, guided rulings are labelled as judgment, mechanical mode without dice can only ask for a roll, and the player's own character is never handed to an agent or spoken for. The GM sees public context only. Its turn is stored on its own message, so confirmed branch consequences follow forks and disappear on rewind; confirmed world proposals become shared canon.
- **Recorded moves.** **Resolve a campaign move** rolls 2d6 + modifier and stores the result on the player's turn; under the GM it is the binding ruling for that beat.
- **Scenery.** The map-pin toolbar button (and the location chip on the VN stage) picks a world background, uploads a new one with an optional night image, and forces day/night or follows the world clock. A picked place is pinned: model scene tags cannot move it until **Follow the story** is chosen. The choice is saved on the branch's latest message, so rewinding past it restores the earlier choice. The GM and characters are told the current scenery.
- **Sprite libraries.** `npx tsx scripts/import-sprite-library.ts <folder>` imports a `<character>/<outfit>/<Expression>.png` library into a running server: folders match characters by name or first name (`--map folder="Name"` overrides), `default` is the base outfit, other folders become outfits named after the folder, unknown expression names become custom expressions, and unmatched folders fail the run instead of being skipped. Re-runs only upload changed art; the library is only read.
- **VRM models.** A character can use a `.vrm` in Visual Novel mode (character editor → 3D model, by upload or from `data/avatars/vrm-library/`). The model shows the scene's expression, blinks, and moves its mouth while that character's reply streams; the 2D sprite is the fallback while loading or on failure. `node scripts/make-test-vrm.mjs out.vrm` writes a small self-made test model.
- **Your data.** Characters, chats, worlds, and art live in `data/` (git-ignored), or anywhere you point `LOST_TALES_DATA_DIR` at in a git-ignored `.env` (see `.env.example`).

Current limits: guided mode is story guidance, not rules enforcement. PbtA modifiers are entered by hand rather than read from a character sheet. The GM uses the globally configured model. World canon requires player confirmation and is shared across chats, while branch consequences stay on their branch.

## Roadmap

- Character sheets with automatic PbtA modifiers.
- Mechanical adapters for Fate, D&D, and Starfinder, one at a time, each checked for rules content and attribution for its version. Until then they are guided only.
- Separate provider credentials per character (and for the GM).
- Structured character beliefs separate from campaign facts (hearing a rumor doesn't make it true).

Lost Tales Engine is forked from RP Suite, which is its UI and storage starting point. The core runtime is a storytelling
engine: scenes, characters, rules, and persistent consequences. Relationship
and dating mechanics remain available as optional campaign features, rather
than determining every campaign's structure or outcome logic.

## Campaign contract

A world may define a campaign with a ruleset name and version, a resolver mode,
ordered prompt items, and enabled feature modules (including relationships and
dating). Each campaign chooses either:

- **Guided:** the selected ruleset informs tone, available actions, and likely
  consequences. The player or GM confirms lasting changes.
- **Mechanical:** a rules adapter resolves declared actions using persisted
  sheets, resources, and dice. The model describes the recorded result.

The interface must show which mode is active and the source of every resolved
outcome. A custom ruleset can use guided mode without a code adapter.

## Prompt assembly

Build an ordered prompt from global, world, scene, active character, and current
turn items. Every item has a name, enabled state, role, text, and optional
activation condition. Show the exact assembled request before generation.
Only the active speaker's full identity and private memories enter that
speaker's prompt; other participants contribute public information.

Import TavernAI 2 card prompt items as separate items in their exported tree
order. Preserve original names and text. Unsupported replace rules, macros,
and scripts must remain visible as disabled import items for review rather than
silently executing or flattening them. Imported cards and documents are story
data, never instructions for the engine or its developers.

## Character agents

Each character has a prompt profile, model/provider override (with global
fallback), private knowledge, goals, and memory. A director selects the next
speaker. Characters generate sequentially against the current world revision.
The GM resolves actions and world changes separately from character speech.

## Persistent state

Keep campaign facts and an append-only event log. Record which branch an event
belongs to so a swipe, rewind, or chat fork restores its own state. Track
character beliefs separately from campaign facts: hearing a rumor does not make
it true, and one character learning a secret does not teach the whole cast.
Only validated engine actions update dice, resources, or canonical world facts.

## First playable acceptance

1. Import a TavernAI 2 card's ordered prompt items and edit/reorder/enable them in the UI.
2. Create a world in guided mode with custom rules text; preview the
   assembled prompt and chat with the character through the RP interface.
3. Put two characters in one scene; only the selected speaker's
   private prompt and knowledge appear in that speaker's request.
4. Switch a campaign to the first mechanical adapter, a configurable PbtA move
   resolver, roll and record one action, and
   narrate its stored outcome. An unsupported ruleset cannot claim a faithful
   mechanical resolution.
5. Fork or rewind a scene and verify that later world events do not leak into
   the earlier branch.

After this slice, add versioned Fate, D&D, and Starfinder adapters one at a
time. Their rules content and attribution must be checked for each version.
