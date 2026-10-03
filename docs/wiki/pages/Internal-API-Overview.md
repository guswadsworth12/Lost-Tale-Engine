# Internal API overview

The Express API serves saved content, media, authentication, backups, roll/state operations, and pack import/export. It is an **internal API**, not a stable public integration contract. Inspect `server/app.ts` and matching `server/*.http.test.ts` before depending on a route or changing its request shape.

## Main boundaries

| Concern | Source to inspect |
| --- | --- |
| HTTP composition and route registration | `server/app.ts`, `server/index.ts` |
| Session and account access | `server/auth.ts`, `server/me.ts`, `server/access.ts`, `server/ownership.ts` |
| Owner housekeeping (removed accounts) | `server/admin.ts`, `server/leftovers.ts`, `server/admin.http.test.ts` |
| Permanent deletes and their cascades | `server/deletion.ts` |
| One-time data migrations | `server/migrations/` |
| Database and persistence | `server/db.ts`, `server/stories.ts`, `server/memories.ts` |
| Rolls and game state | `server/campaignRoll.ts`, related HTTP tests |
| Pack preview, export, import | `server/packPlan.ts`, `server/packExport.http.test.ts`, `server/packImport.http.test.ts` |
| Media and service relay | `server/avatars.ts`, `server/moments.ts`, `server/relay.ts`, `server/vault.ts` |

All writes need server-side validation and ownership checks. A route serving an image or backup can reveal private content even if the page that links to it is private. Keep tests near the route they exercise, including unauthorized and malformed requests. The client adapters live under `src/lib/api/`; use them instead of scattering fetch calls in components.

To inspect behavior locally, run `npm run dev` with disposable data in `LOST_TALES_DATA_DIR`. Keep production backups and API keys out of test fixtures and logs.
