# Visual Novel and VRM

Visual Novel mode stages the current location, cast, and dialogue. A world's **Locations** and **Presentation** tabs hold its backgrounds, music, and saved layouts; individual character sprites, expressions, outfits, alternate forms, and VRM models belong in **Cast → Presentation**.

![Visual Novel mode in Hollowmere: the night platform with Mara, Tavi, and the hooded passenger above Tavi's line in the dialogue box](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-hollowmere-visual-novel.jpg)

## Set the stage

1. Give the world a background per location in **Worlds → Locations**. Each place can have day and night art; the moon toggle on a tile switches to the night variant once the world clock reaches evening.
2. Add each character's sprite or VRM model in **Cast → Presentation**. If a character has more than one form (Hollowmere's Tavi has a fox form), add the form and its art on the character.
3. Open a story in Visual Novel mode. The rail on the right is **Scene controls**; expand it for navigation, **Scenery**, **Stage layout**, each character's appearance, playback, and tools.
4. Under **Stage layout**, choose a **Direction**, how the **Speaker** is shown (**Steps forward** or **Lit only**), and the **Stage width** and **Stage depth**. **Arrange cast** lets you drag each character within the outlined floor, set their **Size**, and choose how they **Enter** and **Leave**. **Save as layout** keeps the arrangement for the world.

![Scene controls expanded over the stage, showing navigation, scenery, and the Stage layout options](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-scene-controls.jpg)

![Arrange cast: the outlined floor with Mara selected, and the Size, Enters, and Leaves controls](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-arrange-cast.jpg)

The stage follows who is in the scene and who is speaking; it does not show every possible cast member. If the speaker stepping forward puts them behind the dialogue box on your screen, switch **Speaker** to **Lit only** or rearrange the cast. On a phone the stage shows the current speaker above the dialogue (or the last speaker during narration) instead of lining up the whole cast. When a form looks wrong, check the character's form art and the **Character appearance** choice in Scene controls before editing the world.

![Hollowmere on a phone: Tavi alone on the stage above the dialogue box](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-phone-visual-novel.jpg)

## VRM models

On a character's **Presentation** tab, **Upload .vrm** or choose one from the VRM library (`data/avatars/vrm-library/`). Visual Novel mode then renders the character in 3D with live expressions and a speaking mouth, and can play gestures such as a wave when the model supports them; both VRM 0.x and 1.0 models stand with their arms at their sides. The 2D sprites stay as the fallback if the model can't load, so keep them. Test at desktop and phone widths; model size and performance vary.

**Scene controls → Main menu** returns access to the rest of the app. [Media and Voice](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Media-and-Voice) explains where generated scene art is kept.
