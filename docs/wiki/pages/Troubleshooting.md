# Troubleshooting

Start with the first failing boundary: app page, local API, text model, or optional image/voice service. The browser console and server log are useful when a button appears to do nothing; remove keys and private story text before sharing logs.

| Symptom | Check |
| --- | --- |
| Page will not open | Is `npm run dev` or the Docker container running? Development normally opens on port 5173; Docker/production uses port 3001 unless configured otherwise. Check the terminal for the actual URL. |
| Sign-in or setup fails | Complete first-run owner setup on the host itself, then sign in. Check cookies and whether a reverse proxy forwards the correct origin. |
| Service shows *Not reachable* | The address must be reachable from the computer running Lost Tales, not from your browser: every service call goes through the server. `localhost` means the server's own machine. |
| Reply does not generate | In **Settings → Models and services**, press **Test and load models** on the service and check the Text model. Hosted services need a valid key and an available model. |
| *The model spent its whole reply budget on hidden reasoning* | The model is a thinking model. Raise **Settings → Generation → Reasoning token reserve** (try 1024), or use a model without a thinking step. Raising the reply length alone doesn't help: each character's reply-length band still caps it. |
| Roll result contradicts prose | Open the recorded roll. Its outcome is authoritative; correct or regenerate narration. Check that the world uses **Roll for outcomes** and the character has a sheet for that world. |
| Character or sprite missing | Check the story's cast, the character's world, its **Presentation** art, its form, and the stage layout. On a phone the stage shows the current speaker rather than everyone. |
| Speaker hidden behind the dialogue box | In **Scene controls → Stage layout**, set **Speaker** to **Lit only**, or use **Arrange cast** to move and resize characters, then **Save as layout**. |
| Image or voice missing | Configure and test the image or voice service separately. Review service errors and costs. |
| Lost context in a long story | Review the latest scene and chapter recaps, Goals, Notes, and Canon. End a scene when the context meter grows crowded. |

Before reporting a bug, try a disposable Hollowmere story and note the app version, OS/browser, steps to reproduce, expected and actual behavior, and sanitized logs. See [Hollowmere Station](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Hollowmere-Station) for a consistent sample.
