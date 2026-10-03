# Run Lost Tales Engine with Docker Compose

Compose runs the built client and Express/SQLite API in one container. It keeps the existing
`./data` bind mount, so an upgrade uses the same database, media, and credential key. Docker
Compose v2 and a text model (local or hosted) are required for AI replies.

## First installation

```bash
docker compose up -d --build
docker compose ps
```

The app listens at <http://localhost:3001> by default. **Create the first owner from the
container shell before signing in:** Docker's port forwarding does not count as a local request
to the app's first-account security check, even when the browser is on the host.

```bash
docker compose exec -u node rp node --experimental-sqlite server/scripts/createUser.ts --username YOUR_NAME --role owner --setup-code
```

The command prints a one-time setup code. Sign in with it, choose a password, then open
**Settings → Models and services**. Do not put passwords or setup codes in Compose files or
command arguments. For an existing installation with an owner account, skip this step.

Hosted providers need only the app container. Save each provider's key in its account settings.
The key is encrypted with `data/secret.key`, which is created automatically on first use.

### Optional local model in Compose

Compose can also run Ollama without publishing its unauthenticated API to the host:

```bash
docker compose --profile local-model up -d --build
docker compose --profile local-model exec ollama ollama pull MODEL_NAME
```

Choose a model that fits your hardware. In **Models and services**, add **Another OpenAI-compatible
service** with address `http://ollama:11434/v1`, choose **Test and load models**, then assign the
downloaded model to **Story replies**. The app's signed-in relay reaches `ollama` on the Compose
network, including when you use the app from another device. No Ollama port or browser CORS
setting is needed for this route. The Ollama model files live in the `ollama` named volume.

For a model server on the Docker host, use an address the *app container* can reach, such as
`http://host.docker.internal:5001` for KoboldCpp. Compose maps that host name on Linux as well.
A host service listening only on `127.0.0.1` may need to bind to a Docker-reachable interface;
keep its network access limited. `localhost` in a service address would mean the app container.

## Ports and remote access

| Compose variable | Default | Purpose |
| --- | --- | --- |
| `APP_BIND_IP` | `127.0.0.1` | Host interface that publishes the app; keep loopback when a reverse proxy runs on the same host. |
| `APP_PORT` | `3001` | Published host port; the container always listens on `3001`. |
| `LT_DATA_DIR` | `./data` | Host directory bound to `/app/data`. Use an absolute path for data outside this checkout. |
| `RP_ALLOWED_ORIGINS` | empty | Additional exact browser origins, comma-separated, such as `https://stories.example.com`. |
| `TZ` | `UTC` | Container time zone. |
| `OLLAMA_IMAGE` | `ollama/ollama:latest` | Optional local-model image tag. |

Put overrides in the git-ignored `.env` beside `docker-compose.yml`, or export them before
running Compose. For another device on a trusted LAN, set `APP_BIND_IP` to the host's LAN address
and allow that exact origin. For internet access, put an HTTPS reverse proxy or tunnel in front
of the loopback-bound app and set `RP_ALLOWED_ORIGINS` to its public HTTPS origin. Forward the
original host and HTTPS scheme. Avoid `RP_ALLOWED_ORIGINS=*` and do not publish an unauthenticated
model endpoint. Owner setup still uses the container-shell command above.

## Data, backups, and updates

`./data` contains `rp.db`, SQLite write-ahead files, uploaded art and audio, and `secret.key`.
It is excluded from the image and from git. **Back up the whole directory, including
`secret.key`**: without that key, saved provider credentials cannot be decrypted. To make a
consistent filesystem backup, stop the app, copy the configured `LT_DATA_DIR`, then start it:

```bash
docker compose stop rp
# Copy ./data (or your LT_DATA_DIR) to a private backup location now.
docker compose start rp
```

The in-app **Settings → Data** download is for app content; it does not replace a full server
backup of accounts, sessions, and the vault key. Keep backups private. `docker compose down`
does not erase the bind-mounted app data; avoid `down -v` if you want to keep Ollama's models.

After backing up, update the checkout and run `docker compose up -d --build` again. Existing
`./data` is reused. The image changes ownership of the mount-point directory to its `node`
user (UID 1000) at startup, then runs the server without root privileges. It does **not**
recursively change existing files. If an imported or custom data directory contains files that
UID 1000 cannot read and write, correct those file permissions on the host before starting.

## Check a deployment

```bash
docker compose ps
docker compose logs --tail=100 rp
curl -fsS http://localhost:3001/api/auth/status
```

The container should become **healthy**, and the status endpoint should return JSON even before
anyone signs in. If it exits, check the logs and data-directory permissions. If a model fails,
test its address from the app container and confirm that the service is saved under **Models and
services**. Image and voice generation need their own providers; the optional Ollama service is
for text replies.
