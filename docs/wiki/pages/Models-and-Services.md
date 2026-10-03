# Models and Services

**Settings → Models and services** holds your service connections and which model does each job. A text model is required to produce new character or Game Master replies. Image and voice services are optional; a hosted service may charge for use and receives the requests sent to it.

![Settings → Models and services with KoboldCpp, Ollama, and Edge TTS services, and the Text, Images, and Voice model choices](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-models-and-services.jpg)

## Connect a text model

1. Open **Models and services** and choose from **Add a service…**. Hosted options include OpenAI, Google Gemini, OpenMayhem, NovelAI, OpenRouter, Nano-GPT, Groq, Mistral, DeepSeek, Together AI, Fireworks AI, and xAI; local options include KoboldCpp, LM Studio, Ollama, and any other OpenAI-compatible server.
2. Open the service's row, check its **Address**, and paste a key if it takes one (keys are saved encrypted to your account, for that service only). Press **Test and load models**; it should report *Works* and how many models it listed. A local server must be running first, and its address must be reachable **from the computer running Lost Tales**: every service call goes through the server's relay.
3. Under **Models**, pick the **Text** service and model. The first-run wizard asks for this, and for a passing test, before it continues.
4. Optionally open **Use a different text model for a job** to give a job its own model: **Story replies**, **Game Master**, **Memory**, **Story tracking**, **Scene vision** (needs a model that can see images), **Writer's Room and creation**, and **Image prompts**. Every other job uses the Text model; if a job's model doesn't answer, that call falls back to the Text model and you're told.
5. Optionally give one character a model of their own, say OpenAI for one and Gemini for another: open their card in **Cast → Advanced → Model**. Only that character's replies use it; everyone else, the Game Master, and memory keep the models chosen here. If it doesn't answer, that reply falls back to the Text model and you're told, so a broken key shows up as a notice rather than a silent switch.

The available models and options depend on the service. Do not paste API keys into screenshots, issues, world packs, or wiki examples. See [Backup, Restore and Privacy](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Backup-Restore-and-Privacy).

### Thinking models

Reasoning ("thinking") models spend part of each reply's token budget thinking before they write. Each character also has a reply-length band that caps how long their replies are, so a short-spoken character can run out before saying anything; the reply then fails with *The model spent its whole reply budget on hidden reasoning*. Raise **Settings → Generation → Reasoning token reserve** (for example to 1024): it adds that many tokens on top of the character's cap. Leave it at 0 for ordinary models.

## Optional services

- **Images:** add an image-capable service (OpenAI, Gemini, OpenMayhem, NovelAI, Automatic1111/Forge, ComfyUI, SwarmUI), pick it under **Models → Images**, then configure **Settings → Images**. These power **Picture this** and character art. Every generated result is previewed before saving.
- **Voice:** **Edge TTS (free)** needs no account; ElevenLabs, Fish Audio, MiniMax, Gemini, OpenAI, Microsoft/Azure Speech, and local Kokoro or AllTalk servers are also supported. Choose voices in **Settings → Voice**; character voice overrides live in **Cast → Voice**.
- **Vision:** scene-vision features need a model that accepts images; a text-only model cannot infer a sprite form from the pixels.

If a model is unavailable, check that its server is running, that the address and port are reachable from the Lost Tales server, the key, and the model name. [Troubleshooting](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Troubleshooting) gives the failure-by-failure checks.
