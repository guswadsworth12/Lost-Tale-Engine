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
