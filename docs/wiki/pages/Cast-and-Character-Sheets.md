# Cast and character sheets

**Cast** holds all characters, including player characters. A character card includes identity, background, behavior, voice, knowledge, relationships, memory, world life, and presentation. Import a TavernAI/SillyTavern-compatible card (Character Card V2, PNG or JSON) with **Import card**, or create one with **New character**, **New player character**, a template, or **Generate with AI**.

![The character editor for Tavi Rook: the grouped sidebar on the left and the Character tab with portrait, world, visibility, and description](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-cast-editor.jpg)

The editor's sidebar groups the tabs: **Who they are** (Character, Background, Sheet), **How they act** (Behavior, Voice, Knowledge, Memories), **Their world** (Relationships, World Life), and **Look and setup** (Presentation, Advanced).

## Make a character playable

1. Set the name, description, and home world in **Character** and **Background**.
2. Define how the character speaks and acts in **Behavior**. Put private knowledge in the appropriate knowledge and memory controls rather than public world canon.
3. In **Presentation**, add sprites per expression, outfits, forms, or a VRM model. **Appearance** lists the base look and each outfit or form (Tavi has **Base** and **Fox**), each with its own description so the model knows what it looks like. These assets belong on the character, not in the Media library.

   ![Tavi Rook's Presentation tab with the Base and Fox appearances and expression sprites](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-cast-presentation.jpg)
4. If the world uses mechanical checks, open **Sheet**, select that world's ruleset, and set its fields and rank.

To have a character voiced by a different model from everyone else (OpenAI for one, Gemini for another), choose it in **Advanced → Model** at the top of that tab. Add the service in **Settings → Models and services** first.

One character can keep **separate sheets for multiple worlds**. Changing the sheet for one world does not replace another. A sheet supplies a move's stat or target when the move is rolled. The engine checks that the sheet belongs to the story's world; if a character has sheets only for other worlds, add the missing sheet before rolling. Older characters with no sheet may enter a value manually.

Built-in presets supply editable core check fields. They do not import complete D&D, Starfinder, Fate, or GURPS characters automatically. Enter or adapt the fields the world's rules actually use, and test a move with that character before a long session.

See [Ruleset Builder](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Ruleset-Builder) and [Visual Novel and VRM](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Visual-Novel-and-VRM).

## Example bank

In a character’s **Behavior** tab, **Example bank** holds up to 40 exchanges, each with up to 3,000 characters. Start each with `<START>` and use `{{user}}:` and `{{char}}:` lines. Toggle situation chips, turn entries on or off, reorder them, or add and delete examples by hand. **Split my current examples into the bank** makes one entry per block and suggests situations; you can edit every suggestion. Clearing the original examples requires confirmation.

The bank is used only with **Deep Memory** on in the character’s world. The original **Example messages** remain the always-sent base. Each reply adds up to two enabled examples that fit the recent six messages and scene state, within an extra budget of about 450 tokens. Situation words and active dates, hangouts, pending rulings and objectives guide selection. If an embedding model is available, the existing recent-conversation comparison also helps; entry comparisons are prepared once per text and model for the browser session. Without it, situation selection still works.

Examples from the previous successful turn for this speaker in this chat are avoided when another fitting example exists. With no match, one everyday example may be used. **Inspect prompt & memory** shows the selected text, situations, similar meaning or fallback, and explains when the bank is off. Enabled bank examples also inform automatic reply length when the module is on; disabled examples do not. Banks travel with JSON/PNG character cards and character/world packs. Turning Deep Memory off, or using a card without a bank, preserves the original prompt behavior.
