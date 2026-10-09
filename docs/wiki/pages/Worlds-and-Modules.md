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

### Optional recall by meaning

Choose an **Embedding model** under **Settings → Models and services**. OpenAI and OpenAI-compatible services are supported, including local servers with an embeddings endpoint. You can type a model name. **Test it** embeds one short sentence and reports its dimensions. A cloud service receives memory text and recent conversation; choose a local service to keep these on your machine.

With Deep Memory on and a model selected, the open scene's memories are prepared in batches of up to 32 while the app is idle. Progress and **Cancel indexing** appear in chat and **Inspect prompt & memory**; **Resume indexing** restarts after cancellation. Indexing pauses during replies and retries failures later. Cancellation resets when you open another scene or choose another model. Memory edits wake indexing; a completed index also checks every five minutes. Closing the app stops indexing.

Each reply uses at most one embedding of the recent six messages, reused by retries and the Inspector. **Similar meaning** explains its extra pull. Characters still know only what they witnessed or were told in this branch. Meaning search has a 2.5-second reply deadline. No model, an empty index, or a failed or slow service keeps the ordinary Deep Memory ranking; the Inspector gives one plain explanation and no toast appears. Deep Memory off or no selected embedding model makes no embedding calls.

Embeddings are derived local data. Editing memory text or changing models makes old vectors unusable. Models keep separate vectors. If a query or **Test it** observes new dimensions under the same model name, indexing rebuilds affected vectors. Forks copy unchanged vectors; deletion and rewind remove vectors with their memories. Full backups omit vectors, and restore clears them so background indexing can rebuild them.

Forgetting a memory or permanently purging its scene removes its recall history. Selecting a different reply restores its own recall history; continuing keeps the original memories, while regenerating replaces that reply’s credit. Rewind undoes the recalled turns too; forks and full backups keep the history that belongs to their memories. Turning Deep Memory off returns to ordinary ranking and keeps recorded places and recall history for later.

## Build in a useful order

1. Write a short **Overview** with what players can do and who the cast is.
2. Set **Story Rules** before creating sheets if rolls matter.
3. Add **Canon** and **Locations**; keep player-visible facts separate from GM-only secrets.
4. Enable **Simulation**, **Relationships**, and **Presentation** only if the story uses them.
5. Open **Advanced** for prompt items and export/import options when needed.

Locations can have day/night backgrounds and music. A scene can pin scenery or **Follow the story** again. **Built-in places** offers stock place names (**Adventure**, **Modern school**); choose **My places only** to list just the world's own.

![The Locations tab of Hollowmere showing its four backgrounds](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-world-locations.jpg) Test a new world with a short story and inspect the assembled prompt before building many assets.

See [World Packs](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/World-Packs) for sharing a reusable world without play history.


With Deep Memory on, the memory scribe can also record up to three connections per memory: people, places and named things, using a fixed set of relationships. It uses the existing scribe call. Connections inherit the memory's knowledge and branch; hidden, retired or folded memories cannot spread a connection into recall. People recorded as present (including your character when present) and the current place lead to neighbours one step away. **Linked through Mara** in the Inspector explains the extra pull, within the same 350-token memory budget.

The chat also records who first said a name where a newcomer could hear it. Only witnesses to that introduction use its connection. Editing, deleting or rewinding the message removes the introduction, and forks keep only introductions from copied messages.

Retiring a memory closes its connections, preserving when they were true. A related replacement can carry a **supersedes** connection added by the engine. Closed connections remain in backups as story history, but do not drive expansion. Editing or changing replies keeps retirements in place. Deleting or rewinding their evidence restarts the earlier batch for re-scribing and reactivates the old memory and reopens its connections, even if Deep Memory is now off. Deletion, purge and source-message retraction remove the memory's connections and any supersedes pointers to it; forks remap memory and message ids. Full backups include connections and restore them.

### Fading and optional consolidation

At scene end, Deep Memory journals keep strongly felt and often recalled memories as individual lines longer, alongside important memories. Pinned memories and open threads never fold. This selection uses no model calls beyond the existing journal writer. With Deep Memory on, at most half the memory prompt budget is reserved for a journal excerpt; individual lines use the remaining space. Excerpts end at a complete sentence when possible, or a word boundary with an ellipsis. The full journal stays saved, and the existing pinned-memory exception remains. Connections strengthen when their memories are recalled and fade with a 60-day half-life after their last use. New connections start aging when created. Older connections without a saved timestamp begin at full strength until their first recorded use. Weak connections remain stored; the Inspector shows their effective strength.

Under **Overview → World modules → Deep Memory**, **Consolidate old memories between sessions** is a separate switch, off by default. Save it and choose a text model to enable a pass after scene-end journals. Each group has at least three settled memories sharing one person, place or thing, using only what each character knows in this branch. The player and speaker are never grouping keys. The largest groups are chosen first, with each memory in at most one group. Important memories (0.7 or above), strong feelings (magnitude 0.5 or above), and often recalled memories (current recall strength 0.5 or above) remain individual lines. Up to three groups become short private summaries in one model call per character. An invalid response saves nothing; errors are reported. Very large groups that exceed the configured context size are left unchanged.

**Consolidate now** runs the same pass for a chosen scene's speaking cast. The daily cap defaults to one attempted run per user, character and world, measured by UTC date. Automatic and manual runs share it. Failed replies also count toward the cap. Undo does not reset the cap. Recent runs show their counts, character and scene with **Undo**. Undo removes their summaries and only that run’s consolidation folds, preserving journal folds; originals stay visible to other knowers and sibling branches. Changing or removing an original memory or its source evidence, retracting a telling, forgetting a summary, or permanently deleting the run’s scene undoes the dependent run. Editing an unrelated latest reply leaves it intact. Summaries preserve people, a shared place, the strongest feeling, secrets and promises, and the weakest certainty of their originals. Forks and full backups preserve the records and weights. This has its own switch until Lean mode is implemented.

### Exploring and correcting memories

Open a character’s **Memories** panel and use **What they know about**. **As of scene** defaults to their latest scene and follows only that scene’s branch. Search people, places and things, then choose one to see its memories, open and closed connections, scene time ranges, and recall counts. Desktop keeps the list beside the detail; phones open a full-width detail with a Back button. Names are shown only for characters your account can see; otherwise they read “Someone.”

Pin or unpin a memory, **Fade for** this character, or **Bring back** a faded memory. These edits work without Deep Memory. **Part of a summary** directs you to Undo in World settings → Deep Memory → Recent runs, preserving separate journal folds. With Deep Memory on, you can change a connection’s relation, close or reopen it, or remove it after confirming. Player-closed connections survive rewind unless their memory is removed. Replacement connections are managed by the engine.

With Character memory and Deep Memory both on, a character reply’s brain button opens **Why these memories?**. It shows the active swipe’s remembered lines and the same reason labels as the Prompt Inspector. Reasons are saved only with Deep Memory on, without model calls or prompt changes. Older or unrecorded replies say **Not recorded for this reply**; Forget removes every recall event and saved reason for that memory, including from future backups. Scene and account visibility are checked on the server before memories, connections or saved reasons are returned.
