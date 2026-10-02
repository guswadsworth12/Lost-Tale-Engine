# Known limits and roadmap

This page distinguishes current behavior from planned work. For tracked priorities and status, use the [roadmap board](https://github.com/users/guswadsworth12/projects/4), [short-term board](https://github.com/users/guswadsworth12/projects/3), and [repository issues](https://github.com/guswadsworth12/Lost-Tale-Engine/issues). Board status can change independently of this guide.

## Current limits

- Mechanical presets implement **core checks** and editable sheet fields. They do not provide full published rulebooks, combat, classes, spells, hit points, or all game-specific resources. Guided mode is narrative judgment, not a recorded roll.
- Writer's Room can create a new roleplay, draft an existing character update, build custom rules, and tune prompts. Conversational updates to existing worlds and lorebooks remain outside that reviewed edit flow.
- Characters have private memory, but a fully structured beliefs system that distinguishes every rumor from campaign truth remains future work. Confirm shared canon deliberately.
- A separate Game Master model can be assigned under **Models and services**; unassigned jobs use the app's fallback model selection. Model availability still depends on the services configured for the account.
- Image, speech, and VRM behavior depend on configured services, model assets, and device capability. A VRM does not gain arbitrary animation simply by importing it.
- Thinking models need **Settings → Generation → Reasoning token reserve** raised; the reasoning effort control offers Low, Medium, and High but no way to switch thinking off.
- The setup wizard's **First story** step offers only the first four bundled characters, so Hollowmere's Mara Vale isn't among them; start Hollowmere from **Stories → Start a story** (a **Play the starter world** button is planned).
- Hollowmere's full-body sprites draw small when three characters share the stage, and with **Speaker: Steps forward** the speaker can sit behind the dialogue box on shorter screens. **Lit only** or **Arrange cast** works around it.

If a feature is absent in your version, check the latest release and its issue before planning around it. Contributions should include a concrete use case and a testable expected result. See [Contributing and Testing](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Contributing-and-Testing).
