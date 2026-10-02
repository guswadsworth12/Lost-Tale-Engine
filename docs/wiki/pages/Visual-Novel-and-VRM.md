# Visual Novel and VRM

Visual Novel mode stages the current location, cast, and dialogue. A world's **Presentation** tab controls reusable visual assets and layouts; individual character sprites, expressions, outfits, alternate forms, and VRM models belong in **Cast → Presentation**.

![Visual Novel scene with background, cast, and dialogue](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/lost-tales-visual-novel.jpg)

## Set the stage

1. Give the world a location background in **Worlds → Locations**. Day and night art can be different.
2. Add each character's sprite or VRM model in **Cast → Presentation**. If a character has multiple forms, define the form and its art on the character.
3. Open a story in Visual Novel mode. Expand **Scene controls** on the side to change scenery and layout.
4. On desktop, adjust the stage area, move characters within it, and set size and entrance/exit behavior. Save a layout to reuse it in the world.

The stage follows scene participants and the current speaker; it does not require every possible cast member to be visible. Only the speaker moves when focus changes. Mobile emphasizes the current speaker above dialogue, or the last speaker during narration, instead of lining up a whole cast. When a form seems wrong, check the character's form assets and the current scene's form selection before editing the world background.

## VRM motion

Import a `.vrm` model on its character. The stage can use VRM expressions and animation support for gestures such as a smile or wave when the model supplies compatible data. Keep a conventional sprite or portrait as a fallback for devices or scenes where 3D is unsuitable. Test the result at desktop and phone widths; model size and performance vary.

**Scene controls → Main menu** returns access to the rest of the app. [Media and Voice](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Media-and-Voice) explains where generated scene art is kept.
