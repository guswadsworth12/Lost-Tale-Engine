# Wiki source

`pages/*.md` is the reviewed source for the [Lost Tales Engine wiki](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki). Edit these files in a normal pull request. Do not make lasting edits in GitHub's wiki editor; the next publish replaces managed pages.

Run `npm run docs:check` before review. Once a change reaches `master`, the Wiki workflow checks the pages and publishes them with a normal commit to the separate wiki Git repository. It never force-pushes or deletes pages that are not in `pages/`. Run the workflow manually from `master` to retry a failed publish. A local maintainer can also run `npm run docs:publish` with Git credentials that can write the wiki.

Write for someone trying to finish a task. Name prerequisites, give the current UI path, show the expected result, and explain what to do if it fails. State when a feature requires a world module, a provider, or owner access. Keep the README short and link to the wiki. Link to repo technical references instead of copying them into multiple guides.

Use the bundled Hollowmere world or other disposable demo data for images. Give every image useful alt text. Label a composed illustration as a mockup; only call a browser capture a screenshot. Never include personal stories, API keys, setup codes, or provider responses containing private data. Check new instructions against the released UI and the corresponding source or tests. Document planned behavior only on the limits and roadmap page.

Keep published page slugs stable. If a page must move, leave a short page at the old slug pointing to the new one.
