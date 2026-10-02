# Troubleshooting

Start with the first failing boundary: app page, local API, text model, or optional image/voice service. The browser console and server log are useful when a button appears to do nothing; remove keys and private story text before sharing logs.

| Symptom | Check |
| --- | --- |
| Page will not open | Is `npm run dev` or the Docker container running? Development normally opens on port 5173; Docker/production uses port 3001 unless configured otherwise. Check the terminal for the actual URL. |
| Sign-in or setup fails | Complete first-run owner setup, then sign in. Check cookies and whether a reverse proxy forwards the correct origin. |
| Reply does not generate | In **Settings → Models and services**, test the text connection and model. Local servers must be reachable from the browser; hosted providers need a valid key and available model. |
| Roll result contradicts prose | Open the recorded roll. Its outcome is authoritative; correct or regenerate narration. Check that the world uses mechanical mode and the character has a sheet for that world. |
| Character or sprite missing | Check the story's participant list, the character's world, its presentation assets, form selection, and the stage layout. Mobile shows the active speaker rather than everyone. |
| Image or voice missing | Configure and test **Settings → Images** or **Voice** separately. Review provider errors and costs. |
| Lost context in a long story | Review the latest scene and chapter recaps, Goals, Notes, and Canon. End a scene when the context meter grows crowded. |

Before reporting a bug, try a disposable Hollowmere story and note the app version, OS/browser, steps to reproduce, expected and actual behavior, and sanitized logs. See [Hollowmere Station](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Hollowmere-Station) for a consistent sample.
