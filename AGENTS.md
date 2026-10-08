# Working on Lost Tales Engine

Rules for any coding agent working in this repository. They apply to every task, in addition to what the issue or prompt asks.

## User data comes first

Lost Tales holds people's private stories: character cards, chats, memories, voice samples. A data mistake can break a campaign someone has played for weeks.

- **Never run scripts, migrations, repairs or ad-hoc SQL against a real data folder.** That means any folder that `LOST_TALES_DATA_DIR` / `RP_DATA_DIR` points at for someone's actual instance, and any `rp.db` you did not create yourself. This holds even when a "repair" looks safe and even with backups.
- **Never move, rename, archive, merge or delete a data folder or database.**
- **Never commit real user data.** That includes cards, chats, memories, voice samples, avatars, exported packs and `.env`. Test fixtures and examples use invented characters and invented text, never names or lines from someone's cards.
- **Run the app against a throwaway data folder** that you create and delete:
  ```bash
  LOST_TALES_DATA_DIR=$PWD/.scratch-data API_PORT=3111 npx tsx watch --experimental-sqlite server/index.ts
  LOST_TALES_DATA_DIR=$PWD/.scratch-data API_PORT=3111 npx vite --port 5283
  npm run create-user   # with the same LOST_TALES_DATA_DIR, for a test account
  ```
  Pick ports that don't collide with an instance the owner is running.
- **Changes to live data are the owner's call.** If fixing something would need it, stop and describe what you would change. The owner decides, and a backup comes first.

## Where to work

- If the main checkout has uncommitted changes, they belong to the owner. Don't edit, stage, stash, reset, clean or commit them. Work in your own git worktree from `origin/master`:
  ```bash
  git fetch origin
  git worktree add ../<folder> -b <branch> origin/master
  ```
- Push only to this repository. Open PRs against `master`.
- One task per branch and per PR. Don't merge your own PR; the owner merges after review and green CI.

## Before you open a PR

```bash
npm run typecheck
npm test
npm run build
```

All three must pass. In the PR description:
- explain what changed and why;
- address each item of the issue's "done when";
- list anything you were unsure about.

## How the code is organised

- **Front end:** `src/`, using React, Vite, TypeScript and Zustand. Prompt building is in `src/lib/prompt/`, chat turns in `src/lib/hooks/useChatSession.ts`, memory in `src/lib/memory/`, the Game Master in `src/lib/world/gm.ts`.
- **Server:** `server/`, using Express and `node:sqlite`. Tables are in `server/db.ts`; deletion and purging in `server/deletion.ts`; rewind in `server/rewind.ts`.
- **Tests:** Vitest, next to the code (`*.test.ts`). `server/httpTestServer.ts` starts a real server on a temporary data folder for route tests.
- **Docs:** user-facing help lives in the in-app Help and `docs/wiki/` (`npm run docs:check`). Update them when you change something a user can see.

## Conventions

- **Match the surrounding code:** naming, comment density, idioms. Some files use Windows line endings (CRLF), so keep each file's existing endings.
- **Plain language in anything a user reads:** no internal names, no jargon.
- **New behaviour that changes prompts or recall goes behind a setting or world module, off by default,** unless the issue says otherwise. With it off, prompts stay unchanged.
- **Characters only know what they witnessed or were told** (`knownBy` on memories). Any new recall or prompt path must respect that, and the current story branch, before it does anything else.
- **No extra model calls per turn** unless the task calls for them. People run local and quota-limited models.
- **Ask before:**
  - a database migration beyond `CREATE TABLE IF NOT EXISTS` or adding optional fields;
  - changing existing prompt wording;
  - adding a dependency;
  - working outside the task's scope.
- **No copied code** from other projects unless their license is compatible with MIT and the source is credited.
