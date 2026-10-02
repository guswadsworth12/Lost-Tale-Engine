# Installation and Docker

Lost Tales Engine runs a React client and a local Express/SQLite API. Use Node.js 22.5 or newer; development uses Node 24. Keep the data directory backed up and outside source control.

## Local development

```bash
git clone https://github.com/guswadsworth12/Lost-Tale-Engine.git
cd Lost-Tale-Engine
npm install
npm run dev
```

Open `http://localhost:5173`. Vite serves the client and proxies `/api` and `/avatars` to the API on port `3001`. Set `LOST_TALES_DATA_DIR` to an absolute directory in a git-ignored `.env` if you want data outside the checkout. On first run, create the owner account, then follow [Quick Start](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Quick-Start).

For a production build, run `npm run build` and `npm start`; the API serves the built client. Use `API_PORT` to choose its port and `API_HOST` to choose its bind address. `npm run typecheck` and `npm test` are the project checks.

## Docker

```bash
docker compose up -d --build
docker compose exec -u node rp node --experimental-sqlite server/scripts/createUser.ts --username YOUR_NAME --role owner --setup-code
```

On a fresh install, sign in at `http://localhost:3001` with the one-time code printed by the second command, then choose a password. Existing installations with an owner skip that command. Docker port forwarding cannot satisfy the app's local-only first-owner browser check, even when the browser is on the host. Compose keeps the existing `./data` bind mount for the database, media, and credential key; back up the entire directory. The full [Docker reference](https://github.com/guswadsworth12/Lost-Tale-Engine/blob/master/DOCKER.md) covers the optional Ollama profile, port binding, backups, and updates.

The app is bound to host loopback by default. Remote access needs an appropriate `APP_BIND_IP`, an exact `RP_ALLOWED_ORIGINS`, and an HTTPS reverse proxy or similarly protected network. Never use a wildcard origin as a substitute for access control.

The app's signed-in relay makes model requests from the container. With the optional Ollama profile, use `http://ollama:11434/v1` in Models and services; for a model on the Docker host, use a container-reachable address such as `http://host.docker.internal:5001`. See [Models and Services](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Models-and-Services).
