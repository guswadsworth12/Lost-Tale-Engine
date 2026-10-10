# Stories and scenes

A **story** is your ongoing roleplay. It contains chapters, and each chapter contains numbered scenes. Breaking play into scenes gives the model a manageable recent transcript while recaps carry the important context forward.

![The Stories library with the Hollowmere story card showing its world, place, day and time, last line, cast, and who you play](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-stories-library.jpg)

## Start or resume

1. Open **Stories → Start a story**.
2. **World:** choose a world or **Freeform · no world**.
3. **Cast:** choose the **Main character**, then any **Other characters** who can speak in the scene.
4. **Who you play:** pick a character, play as yourself unnamed, or **Create** a new player character.
5. **Opening scene:** choose a story style (**Freeform RP**, **Visual Novel**, or **Dating Sim**) and an opening line, then select **Begin story**.

Open a story card to resume its current scene. Cards show the world, current place and time, the last line, the cast, and who you play. A card's **Story actions** menu (**⋯**) holds **Pin to top**, **Rename**, **Duplicate current scene**, **Duplicate full story**, **New with same cast and player**, and **Delete**; read the confirmation before deleting. Deleted stories wait in **Trash** for a while before they're purged.

## Move through a long story

Open **Story panel → Scenes** to revisit earlier scenes or **Read the whole story**. **End scene…** opens a dialog that drafts a recap with your model: check and edit **What happened**, keep or remove **Open threads**, review any **Lasting changes** proposed as world canon (a fact you record this way is only told to the characters who were in the scene, so a private plan doesn't reach someone who wasn't there; facts you type into the world yourself are told to everyone), and set up the next scene (title, location, lead, and who's there). Tick **Also end Chapter 1** to close the chapter with its own recap, or **Split off a parallel storyline** to branch. Read the recap before carrying it forward: a bad summary can distort later play.

![The End Scene dialog with a model-written recap, two open threads, and the next-scene options](https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/screenshots/wiki-end-scene.jpg)

## Share a story

**Read the whole story** (in **Story panel → Scenes**, or **Tools → Export story (text, Markdown, Word, PDF)…** while playing) shows every scene in order. Its **Export** bar saves the story to share:

- **Text** (.txt): plain text, actions in \*asterisks\*.
- **Markdown** (.md): bold speakers and italic actions, for Reddit, Discord, and forums.
- **Word** (.docx): opens in Word, Google Docs, and LibreOffice; each chapter starts a new page.
- **PDF**: opens the print dialog with a book-style page; choose **Save as PDF**.

Untick **Include recaps** to share just the story. Failed replies are left out, and each message exports the reply you kept. **Export scene as HTML** in Tools still saves a single scene as a web page with portraits.

To explore a different branch, use **Fork chat from here** on a message; **Rewind to here** deletes that message and everything after it, and takes the scene back to how it stood just before it: the memories, facts, relationship changes and objective progress from those messages go, and relationships, gifts, scene state and tracked state come back as they were. The dialog lists what it will undo first. If the world clock has moved since, it offers to set it back; that's ticked only when no other story in the world has been played since, because every story there shares the clock. A backup of the database is saved in the data folder's `backups` first (the newest ten are kept). Messages saved before this feature can be rewound, but their scene state stays as it is now. Later branch state does not travel backward. The current story remains available from the main menu while you play.

## Related

- [Playing a Scene](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Playing-a-Scene)
- [Story State and Continuity](https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/Story-State-and-Continuity)
