# Recall test bench

Run from the repository root, using the existing Node and npm setup:

```sh
npm run memory:eval
npm run memory:eval -- --module on
npm run memory:eval -- --budget 200 --module off
npm run memory:eval -- --cases .memory-eval/private
```

`--cases` accepts one JSON file or a directory of JSON files. A file holds one case
or an array of cases. Files run in filename order. No database or model service is
opened by the runner. It uses `selectMemoriesExplained`, after the same
scene-chain and branch-telling filters as the memory route. Recent context is the
last six `scene.recentMessages`; the question is a human label, never extra context.

The default budget is `MEMORY_TOKEN_BUDGET` (350). Costs include the existing
memory formatting and feeling cues. Pinned memories retain the ranker's existing
exception: up to eight can exceed the budget. The report shows every picked id,
all its ranking reasons, missing expected ids, forbidden picks, and actual tokens.
Recall is the total expected ids picked divided by total expected ids; a case is a
hit only when all its expected ids are picked and none of its forbidden ids are.

Ordinary misses are measurements and exit successfully. Any forbidden pick or
failed `mustNeverRegress` case exits with status 1, as do invalid input and options.
`--module off` is the original ranking. `--module on` enables the feeling, place
and recall-strength terms and labels the report accordingly. Both use the same
knowledge and branch filters before scoring.

## Case format

See `fixtures/cases.json` for twenty fully synthetic cases. Each case has:

- `id`, `category`, `question`: stable name, category and human question.
- `cast`: invented character ids and names.
- `memories`: full `CharacterMemory` objects, including text, kind, importance,
  feelings, about, witnesses, knownBy, active state, origin and createdAt.
  Optional `location` and `recalls: { count, lastAt }` drive Deep Memory; `links`
  remains reserved for later phases. The baseline ignores these fields. Keep
  times fixed for repeatable runs.
- `chats` and `stories`: ids and the real scope fields (`previousSceneId`,
  `storyId`, `continuesFrom`). Include sibling scenes when testing exclusions.
- `scene`: chatId, speakerId, presentIds, location, atmosphere, recentMessages.
  Optional `now` fixes the evaluation clock in milliseconds; without it the
  bench uses 2,000,000,000, so repeated runs do not drift.
- `expectedIds`: one or more memories needed to answer the question.
- `forbiddenIds`: memories the speaker must never receive.
- `mustNeverRegress`: true for protected knowledge and branch cases.

The suite covers wording (4), connections (3), emotion (3), place (3), knowledge
(4) and branches (3). Crowded cases compete with ordinary recent memories at the
production budget. The seven protected cases also cover pinned secrets, retired
and folded memories, sibling scenes, off-branch tellings and sequel ancestry.
Every protected case expects a valid memory as well, so an empty result cannot pass.

## Private local cases

The owner can run this command locally. Coding agents must never run it on real
campaign data. It requires an explicit database path; it does not load `.env`, use
the app's database module, start the server, create tables or run migrations.
SQLite is opened read-only and closed even when the export fails.

```sh
npm run memory:export -- \
  --database /path/to/your/rp.db \
  --chat scene-id \
  --speaker character-id \
  --expected memory-id-one,memory-id-two \
  --question 'What should this character remember here?'

npm run memory:eval -- --cases .memory-eval/private
```

The export is `.memory-eval/private/<scene-id>.json`, ignored by git. New folders
use owner-only permissions and the file uses mode 0600; existing files are never
overwritten. It includes memories from the visible scene chain, minimal cast
names and scope fields, and the speaker's last six witnessed messages in the
current scene, excluding failed and empty messages. Phase 1 exports also include
branch-scoped recall counts, the current replayed location and a fixed evaluation clock. It omits full character cards, story descriptions and unrelated
transcripts. Review or edit the expected ids and recent context locally before
measuring a particular turn: this context approximates the prompt history, whose
transformations are not reproduced.
You can add forbidden ids and mark private cases as protected too.

Private files and their evaluation output remain private: reports include the
question, ids and matched words. Do not commit exports or upload reports.

## Phase 0 baseline and Phase 1 comparison

On the twenty checked-in cases, module off, budget 350:

| Measure | Module off | Module on |
| --- | --- | --- |
| Complete case hits | 13 / 20 | 18 / 20 |
| Expected memories picked | 16 / 23 | 21 / 23 |
| Recall at budget | 69.6% | 91.3% |
| Emotion cases | 0 / 3 | 3 / 3 |
| Place cases | 1 / 3 | 3 / 3 |
| Protected cases passed | 7 / 7 | 7 / 7 |
| Forbidden picks | 0 | 0 |

These numbers describe this synthetic suite, not a general measure of story quality.
Keep labels and cases fixed when comparing later phases. The tests verify boundaries
and reporting, rather than requiring ordinary ranking misses to stay misses.


The module-off snapshot was captured from merged Phase 0 before ranking changed.
It locks every case's pick order and exact memory prompt text. Do not update it to
accommodate a regression. Both modes also test that turning off each protected
fixture's guard makes its forbidden memory appear.

Phase 1 weights live in `DEEP_MEMORY_WEIGHTS`: feeling 0.5, same place 0.5, recall
strength 0.25, alongside the unchanged baseline weights. Recall strength is
`min(1, log1p(count) / log(11)) * 0.5 ** (age / 30 days)`: it caps at ten recalls
and halves after thirty days. Only this speaker's feelings and recall counts are used.

The production client gets counts with its existing per-speaker scene-memory
request. After a usable reply is saved it sends one best-effort batch, with the
reply id and the union of memories supplied across automatic continuations. No
extra model call or extra read request is needed. The local `memory_recalls` table
keeps `(memoryId, characterId)` aggregates and reply events so rewind can undo a
reply's contribution to old memories too. Events follow copied memories on fork,
are scoped to the scene chain on reads, and are included in backup/restore. An old
backup without this table restores with empty recall history.
