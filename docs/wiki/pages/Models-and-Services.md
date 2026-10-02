# Models and Services

**Settings → Models and services** holds provider connections and model assignments. A text model is required to produce new character or Game Master replies. Image and voice services are optional; a hosted service may charge for use and receives the requests sent to it.

## Connect a text model

1. Open **Models and services**. Choose a service under **Hosted** or **On your machine**. Examples include OpenAI, Google Gemini, NovelAI, OpenMayhem, KoboldCpp, and OpenAI-compatible servers such as LM Studio or Ollama.
2. Enter the service URL and credentials it needs. For a local server, start that server first and use an address the browser can reach. Test the connection where the service row offers a test.
3. Select a model for **Story replies**. The first-run wizard requires this before continuing. You may assign separate models to Game Master, memory, tracking, vision, creation, and image-prompt jobs; unassigned jobs follow the app's normal fallback selection.

The available models and options depend on the service. Do not paste API keys into screenshots, issues, world packs, or wiki examples. Hosted secrets are saved per account; see [Backup, Restore and Privacy](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Backup-Restore-and-Privacy).

## Optional services

- **Images:** choose an image-capable service in **Models and services**, then configure **Settings → Images**. These power **Picture this** and character art. Every generated result is previewed before saving.
- **Voice:** choose a voice service and options in **Settings → Voice**. Free voices and hosted or self-run speech services have different requirements. Character voice overrides live in **Cast → Voice**.
- **Vision:** scene-vision features need a model that accepts images; a text-only model cannot infer a sprite form from the pixels.

If a model is unavailable, verify its server is running, the browser-visible URL and port, credentials, and any cross-origin settings. [Troubleshooting](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Troubleshooting) gives the failure-by-failure checks.
