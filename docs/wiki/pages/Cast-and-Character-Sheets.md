# Cast and character sheets

**Cast** holds all characters, including player characters. A character card includes identity, background, behavior, voice, knowledge, relationships, memory, world life, and presentation. Import a SillyTavern card or create one with **New character**, a template, or AI generation.

![Cast editor showing a character's Visual Novel sprites](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/lost-tales-cast-sprites.jpg)

## Make a character playable

1. Set the name, description, and home world in **Character** and **Background**.
2. Define how the character speaks and acts in **Behavior**. Put private knowledge in the appropriate knowledge and memory controls rather than public world canon.
3. In **Presentation**, add portrait, sprites, expressions, outfits, forms, or a VRM model. These assets belong on the character, not in the Media library.
4. If the world uses mechanical checks, open **Sheet**, select that world's ruleset, and set its fields and rank.

One character can keep **separate sheets for multiple worlds**. Changing the sheet for one world does not replace another. A sheet supplies a move's stat or target when the move is rolled. The engine checks that the sheet belongs to the story's world; if a character has sheets only for other worlds, add the missing sheet before rolling. Older characters with no sheet may enter a value manually.

Built-in presets supply editable core check fields. They do not import complete D&D, Starfinder, Fate, or GURPS characters automatically. Enter or adapt the fields the world's rules actually use, and test a move with that character before a long session.

See [Ruleset Builder](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Ruleset-Builder) and [Visual Novel and VRM](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Visual-Novel-and-VRM).
