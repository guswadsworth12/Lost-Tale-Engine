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
```

Open `http://localhost:3001`. Compose mounts `./data` for the database and uploaded media. Back up that directory. The full [Docker reference](https://github.com/guswadsworth12/Lost-Tale-Engine/blob/master/DOCKER.md) lists the bind and origin settings.

First owner-account setup is allowed only from the host itself. If the UI is on another device, finish setup at `localhost` on the host or use `npm run create-user` there. Later visitors sign in normally. Remote access needs an appropriate bind address, `RP_ALLOWED_ORIGINS`, and an HTTPS reverse proxy or similarly protected network. Never use a wildcard origin as a substitute for access control.

The browser must be able to reach the model endpoint you configure; `localhost` in a browser on another device points to that device, not the server. Choose an address the browser can resolve. See [Models and Services](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Models-and-Services).
