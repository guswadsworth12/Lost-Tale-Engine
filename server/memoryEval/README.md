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
reply id, swipe index, and the union of memories supplied across automatic continuations. No
extra model call or extra read request is needed. The local `memory_recall_events` table
keeps one row per `(memoryId, characterId, messageId, swipe)`. Indexed deletes undo a
reply's contribution without scanning unrelated history. Counts and last recall time
are aggregated in SQL for the speaker and visible scene chain, using only active swipes.
Selecting an existing swipe restores its credit; continuation adds picks to the same
swipe, and regeneration replaces that swipe's credit. Events follow copied memories on fork,
are scoped to the scene chain on reads, and are included in backup/restore. An old
backup without this table restores with empty recall history, ignoring the earlier
unshipped `memoryRecalls` aggregate format.


## Phase 2: optional recall by meaning

`npm run memory:eval -- --module on --embedder stub` runs the deterministic synthetic
embedder defined by `fixtures/stub/concepts.json`. It maps the hand-written crossing
and gift phrases to shared concepts, with a neutral catch-all for unrelated text.
This proves storage/scoring/ranking wiring and knowledge guards, **not real-world
embedding quality**. The production app never uses this stub. The original cases,
expected IDs, and module-off prompt snapshots are unchanged. All seven protected
cases and guard-removal leak tests also run with both stub modes.

`npm run memory:eval -- --module on --embedder stub-compressed` uses the same
concepts with shared background components, producing cosine scores in 0.45..0.70.
This exercises compressed score calibration through the production filters and
ranking; it remains synthetic and does not measure real-model quality.

| Mode | Case hits | Expected recalled | Recall | Forbidden / protected failures |
| --- | ---: | ---: | ---: | ---: |
| Off | 13/20 | 16/23 | 69.6% | 0 / 0 |
| On, no embedder | 18/20 | 21/23 | 91.3% | 0 / 0 |
| On, synthetic stub | 20/20 | 23/23 | 100.0% | 0 / 0 |
| On, compressed synthetic stub | 20/20 | 23/23 | 100.0% | 0 / 0 |

Different-wording case hits improve from 2/4 to 4/4 with the stub. The additional
similarity weight is **0.75** times a calibrated score. With at least five finite
scores among this speaker’s eligible memories, the median maps to zero and the
maximum to one; scores below the median add nothing. A flat distribution adds
nothing. Smaller sets use `clamp((cosine - 0.4) / 0.6, 0, 1)`. **Similar meaning**
requires a calibrated score of at least **0.6**. These constants and the method
live beside `DEEP_MEMORY_WEIGHTS`; real-provider tuning is still unmeasured.
Existing weights and the 350-token budget remain.

For an explicitly owner-run evaluation of a real **local** endpoint:

```bash
npm run memory:eval -- --module on --embeddings-url http://localhost:1234/v1 --embeddings-model your-embedding-model
```

This sends fixture memory text and recent context to that endpoint in batches of
32. It is never run in tests or CI. No API key is read. If the endpoint fails, this
explicit evaluation fails instead of reporting keyword fallback as embedding
results. The app's browser uses the existing relay and vault credential instead;
the application server stores vectors and computes similarity, never calls models.

The index is normalized Float32 BLOB data in `memory_vectors`, outside backups.
The primary key is `(memoryId, model)`, so models coexist. SHA-256 of
`model + text` prevents stale vectors being used. Dimension mismatches are skipped;
a query or **Test it** observes changed dimensions and queues affected memories
for reindexing even when the model name stays the same. Candidate branch,
known-by, active and folded state are checked before any vector lookup or cosine.
The server returns scores only, never candidate vectors. The browser query cache
holds up to 32 text/configuration hashes, shares in-flight calls across retries
and the Inspector, and backs off failed embeddings for 30 seconds. Query embedding
and score requests share a **2.5-second** reply deadline; background embedding keeps
its **15-second** limit. Background indexing pauses while generating, wakes after
memory writes, scene/model changes or observed dimension changes, and checks every
five minutes as a safety net after completion. Cancellation applies to the current
scene/model and resets when either changes. Failures retry with increasing delay
up to a minute. Restoring a backup clears the
index. No configured model or a disabled module makes no embedding calls.


### Similarity payload measurements

Measured UTF-8 JSON bytes using deterministic normalized Float32 sine vectors,
a synthetic model name, and a 36-character speaker ID (no provider or user data):

| Dimensions | One similarity query | Local vector BLOB |
| ---: | ---: | ---: |
| 768 | 16,218 bytes | 3,072 bytes |
| 1,536 | 32,570 bytes | 6,144 bytes |
| 3,072 | 65,628 bytes | 12,288 bytes |

A score-only response with 36-character memory IDs and 16-digit scores is 1,857
bytes for 32 candidates, or 58,001 bytes for 1,000. Actual JSON sizes depend on
numeric precision and names. Only one query vector is sent per context; candidate
vectors stay in SQLite. The browser must be on HTTPS or localhost to hash cached
queries; otherwise the Inspector explains that ordinary recall is being used.
