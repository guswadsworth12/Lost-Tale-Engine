# Architecture and data flow

Lost Tales Engine is a React/TypeScript client built with Vite and a local Express API backed by `node:sqlite`. In development, Vite and the API run separately; production serves the built client and API from one Node process. The app stores content and media in a git-ignored data directory.

```text
Browser UI (src/components)
  → client state and session logic (src/lib, src/lib/hooks)
  → local API (server/app.ts, server/index.ts)
  → SQLite and media (server/db.ts, data/)
  → configured text/image/voice services when a user invokes them
```

The play pipeline assembles world, character, scene, memory, and rules context before calling the configured text model. The GM orchestrates turns, but server-side rolls and tracked-state events are recorded separately from generated prose. Model text cannot rewrite a stored check. Scene and chapter recaps carry continuity to later context windows; branch state derives from its own message history.

The browser never calls an outside service directly: every model, image, and voice request goes through the server's relay (`server/relay.ts`), which attaches the user's saved key (encrypted at rest by `server/vault.ts`) so it never reaches the browser. The relay only forwards to the user's saved service addresses or fixed providers, so the server, not the browser, must be able to reach them. Authentication and ownership checks sit at the API boundary; do not rely on a hidden UI control for access control.

Useful entry points: `src/App.tsx` (navigation), `src/lib/hooks/useChatSession.ts` (play), `src/lib/api/` (providers), `server/app.ts` (HTTP routes), `server/campaignRoll.ts` (rolls), `server/stories.ts` (story state), `server/packs.ts` (packs), `server/auth.ts`, `server/access.ts`, and `server/ownership.ts` (access), and `server/admin.ts` (owner housekeeping). See [Internal API Overview](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Internal-API-Overview).
