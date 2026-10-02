# Contributing and testing

Start with an issue or a small reproducible use case. Work from the current default branch, keep unrelated changes out of the patch, and explain the user-visible behavior and remaining limits in a pull request. Source docs in `docs/wiki/pages/` are reviewed and published to the GitHub Wiki after merge.

## Local checks

```bash
npm install
npm run typecheck
npm test
npm run build
npm run docs:check
```

Use a separate `LOST_TALES_DATA_DIR` for manual testing. Exercise both desktop and mobile when changing navigation or Visual Novel play. For rules or state changes, test a successful, mixed, and failed roll and verify that narration respects the stored outcome through rewind, fork, and scene transition. For access changes, test owner, another signed-in user, and unauthenticated requests.

Documentation changes should name the actual UI labels, state prerequisites, and link to related tasks. Take screenshots from a disposable install (a fresh `LOST_TALES_DATA_DIR`) with only the bundled demo content, at 1280×800 for desktop and 390×844 for phones, and save them as JPEGs under `screenshots/` (the wiki's existing images are named `wiki-*.jpg`). A keyless local model (for example Ollama) gives real replies without exposing a key. Never capture spoilers such as a world's GM notes, keys, or setup codes. Images composed from art should say **mockup**, not screenshot. Run `npm run docs:check`; the Wiki workflow publishes merged docs without rewriting unrelated wiki pages.

See the [repository README](https://github.com/guswadsworth12/Lost-Tale-Engine) and [wiki source guide](https://github.com/guswadsworth12/Lost-Tale-Engine/blob/master/docs/wiki/README.md).
