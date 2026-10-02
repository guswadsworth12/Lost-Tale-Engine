# Running Lost Tales Engine in Docker

The image runs the whole app from one Node process — the Express API and the built client on a
single port (3001 by default). Your text/image model backend (KoboldCpp, LM Studio, an API
provider…) stays wherever you already run it. Local model URLs must be reachable from the
browser; configured hosted services may use the server's credential relay.

## Quick start

```bash
docker compose up -d --build
```

Then open <http://localhost:3001>, create the owner account on the host, and in **Settings → Models and services** connect your model backend. The first run seeds starter content, including Hollowmere Station, into `./data`.

Without compose:

```bash
docker build -t rp-suite .
docker run -d --name rp -p 3001:3001 -v "$(pwd)/data:/app/data" rp-suite
```

## Data

Everything — characters, chats, worlds, personas, and every uploaded image — lives under
`/app/data` (a SQLite file plus ordinary image/audio files). The compose file bind-mounts `./data`;
back that directory up, or point the mount somewhere else. Delete it to start over.

## Environment variables

| Variable | Default (in image) | Purpose |
| --- | --- | --- |
| `API_PORT` | `3001` | Port the server listens on. |
| `API_HOST` | `0.0.0.0` | Bind address. The image sets `0.0.0.0` so Docker's published port works; the app's own default outside Docker is `127.0.0.1`. |
| `RP_ALLOWED_ORIGINS` | *(unset)* | Extra browser origins the API accepts, beyond loopback. Needed if you reach the UI from another device or through a reverse proxy — e.g. `http://192.168.1.9:3001,https://rp.example.com`. Avoid `*`, which disables the origin check. |

The API requires an account session. If you expose it beyond `localhost`, use HTTPS and set
`RP_ALLOWED_ORIGINS` to the browser origins you use. A reverse proxy, VPN, or SSH tunnel adds
another access boundary. First-run owner creation must happen locally on the host.

## Reaching a model backend

The browser makes the model calls, so use an address the *browser* can resolve:

- KoboldCpp on the same machine as your browser → `http://localhost:5001` works as-is.
- KoboldCpp on the Docker host, browser elsewhere → use the host's LAN address.
- KoboldCpp in another container → expose its port and use `http://host.docker.internal:5001`
  (add `extra_hosts: ["host.docker.internal:host-gateway"]` on Linux).

## Notes

- Node 24 base image; the server runs its TypeScript directly via Node's built-in type stripping,
  so there's no separate server build step.
- `npm start` runs the same production server locally (after `npm run build`), without Docker.
