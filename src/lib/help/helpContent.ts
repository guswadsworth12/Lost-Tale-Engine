/**
 * The "Help & tutorial" reference: every topic, as plain data, so the wording is easy to revise and
 * the coverage is testable without rendering anything.
 *
 * Every control named here was checked against the UI source at the time of writing, using its real
 * visible label (or its tooltip / aria-label for icon-only buttons). Wrap a control's label in
 * `**…**` to render it bold. If you rename a button, search this file for its old label.
 */

export const HELP_TOPIC_IDS = [
  'getting-started',
  'navigation',
  'stories',
  'scenes',
  'playing',
  'visual-novel',
  'story-panel',
  'cast',
  'worlds',
  'lore',
  'media',
  'writers-room',
  'settings',
  'campaign',
  'simulation',
  'dating',
  'shortcuts',
] as const

export type HelpTopicId = (typeof HELP_TOPIC_IDS)[number]

export const HELP_GROUPS = ['Start here', 'Play', 'Studio', 'Tools', 'Optional systems'] as const
export type HelpTopicGroup = (typeof HELP_GROUPS)[number]

/** Icon keys, mapped to lucide icons by the component so this module stays free of React. */
export type HelpIconName =
  | 'compass'
  | 'menu'
  | 'library'
  | 'message'
  | 'drama'
  | 'panel'
  | 'users'
  | 'globe'
  | 'book'
  | 'gallery'
  | 'sparkles'
  | 'settings'
  | 'dice'
  | 'clock'
  | 'heart'
  | 'keyboard'

export type HelpBlock =
  | { kind: 'text'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'steps'; items: string[] }
  /** A callout: a condition ("only when…") or a caveat worth not missing. */
  | { kind: 'note'; text: string }
  | { kind: 'keys'; rows: { keys: string; description: string }[] }

export interface HelpSection {
  /** Unique across all topics; also used as a DOM id for jump links. */
  id: string
  heading: string
  blocks: HelpBlock[]
}

export interface HelpTopic {
  id: HelpTopicId
  title: string
  group: HelpTopicGroup
  icon: HelpIconName
  /** One line shown under the title and in search results. */
  summary: string
  /** Shown as a badge when the whole topic depends on a world setting. */
  condition?: string
  /** Extra search words that don't appear in the text (synonyms, old names). */
  keywords?: string[]
  related?: HelpTopicId[]
  sections: HelpSection[]
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    group: 'Start here',
    icon: 'compass',
    summary: 'What Lost Tales Engine is, and the three things to do first.',
    keywords: ['welcome', 'intro', 'tutorial', 'tour', 'first run', 'model', 'connect'],
    related: ['navigation', 'stories', 'settings'],
    sections: [
      {
        id: 'gs-what',
        heading: 'What this app is',
        blocks: [
          {
            kind: 'text',
            text: 'Lost Tales Engine is a local-first storytelling engine. You play stories with AI characters, in worlds you define, using a model you bring: a local server (KoboldCpp, LM Studio, Ollama, llama.cpp, TabbyAPI) or a hosted provider with your own API key.',
          },
        ],
      },
      {
        id: 'gs-first-steps',
        heading: 'First steps',
        blocks: [
          {
            kind: 'steps',
            items: [
              'Connect a model. A fresh install opens on the Welcome screen, which asks for a **Local server** or a **Cloud provider**. You can change it any time in **Settings → Models and services**.',
              'Meet your cast. Open **Cast** to create a character with **New character**, build one with **Generate with AI**, bring one in with **Import card** (.json or .png), or **Start from a template**.',
              'Start a story. Go to **Stories** and choose **Start a story**.',
            ],
          },
        ],
      },
      {
        id: 'gs-map',
        heading: 'Where things live',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Play**: **Stories**, your library of stories.',
              '**Studio**: **Cast** (every character, including the ones you play), **Worlds** (settings and their rules), **Lore** (standalone lorebooks) and **Media** (story CGs and each world\'s soundtrack).',
              "**Tools**: **Writer's Room** (a planning assistant) and **Settings**.",
            ],
          },
          {
            kind: 'text',
            text: 'On a computer the menu is a rail on the left; **Expand menu** at its bottom shows the labels (**Collapse menu** hides them again). On a phone it is a bar along the bottom of the screen.',
          },
        ],
      },
      {
        id: 'gs-help',
        heading: 'Getting help later',
        blocks: [
          {
            kind: 'list',
            items: [
              'Open **Help & tutorial** from the menu to come back to this reference, or to replay the guided tour with **Take the tour**.',
              'Press **Ctrl/Cmd K** to search for any story, cast member, world or section.',
              'Press **?** (outside a text box) to see the keyboard shortcuts.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'navigation',
    title: 'Getting around during play',
    group: 'Start here',
    icon: 'menu',
    summary: 'The Menu button, the compact rail, and getting back to your library.',
    keywords: ['sidebar', 'rail', 'drawer', 'back', 'library', 'menu', 'mobile', 'phone'],
    related: ['stories', 'scenes', 'shortcuts'],
    sections: [
      {
        id: 'nav-desktop',
        heading: 'On a computer',
        blocks: [
          {
            kind: 'text',
            text: 'Opening a story keeps the menu available. The left menu collapses to its compact icon rail so the scene has room.',
          },
          {
            kind: 'list',
            items: [
              'In Classic, **Menu** in the play header expands or collapses the left menu. In Visual Novel, expand **Scene controls** on the right and choose **Main menu**.',
              "The rail's own **Expand menu** / **Collapse menu** button at its bottom works too.",
              '**Stories** in the menu takes you back to the open story from any other view. Choose it again while you are already there to reach the library.',
            ],
          },
        ],
      },
      {
        id: 'nav-mobile',
        heading: 'On a phone',
        blocks: [
          {
            kind: 'text',
            text: "The bottom navigation bar is hidden while you play. In Classic, tap **Menu** in the header; in Visual Novel, expand **Scene controls** at the top right and tap **Main menu**. The drawer has **Back to Stories**, **Current story**, **Studio** (**Cast**, **Worlds**, **Lore**, **Media**), **Tools** (**Writer's Room**, **Settings**) and **Help & tutorial**.",
          },
        ],
      },
      {
        id: 'nav-back',
        heading: 'Back to your stories',
        blocks: [
          {
            kind: 'text',
            text: '**Back to Stories** in the Classic header, Visual Novel side rail or phone drawer returns to the library. Nothing is lost: open the story card again to continue its current scene. On wider screens the Classic header also has a **Studio** shortcut to Cast.',
          },
          { kind: 'text', text: 'To look back at an earlier scene of the same story, open **Story panel → Scenes**. See Scenes and long stories.' },
          { kind: 'text', text: '**Ctrl/Cmd K** jumps straight to any story, cast member, world or section from anywhere.' },
        ],
      },
    ],
  },
  {
    id: 'stories',
    title: 'Stories',
    group: 'Play',
    icon: 'library',
    summary: 'Your library: starting, continuing and managing stories.',
    keywords: ['chat', 'chats', 'new chat', 'library', 'begin', 'trash', 'restore', 'fork', 'branch', 'duplicate', 'scenes'],
    related: ['scenes', 'playing', 'navigation', 'cast'],
    sections: [
      {
        id: 'stories-library',
        heading: 'The library',
        blocks: [
          {
            kind: 'text',
            text: 'Stories shows one card per story: its title, its world (or "Freeform world"), how many scenes it has, where the scene is, the day and time of day when the world keeps a clock, the current goal or the last line, the cast, and when you last played. Pinned stories stay at the top.',
          },
          {
            kind: 'text',
            text: 'A story is a chain of scenes, each its own short chat, so long stories stay within what the model can hold. See Scenes and long stories.',
          },
        ],
      },
      {
        id: 'stories-start',
        heading: 'Start a story',
        blocks: [
          { kind: 'text', text: '**Start a story** walks through four steps. **Back** and **Continue** move between them.' },
          {
            kind: 'steps',
            items: [
              '**World**: pick a world, or **Freeform · no world**.',
              "**Cast**: choose the **Main character**, then optionally other characters who can speak in the scene. Only characters who live in the chosen world are listed (for Freeform, characters without a world).",
              "**Who you play**: pick from **Player characters**, then **Cast**, or play as an unnamed **You**. It starts on the card you last played; the story's main character isn't offered.",
              '**Opening scene**: pick a **Story style** (Freeform RP, Visual Novel or Dating Sim), how you know each other if the character offers starters, and which **Opening line** to use. Then **Begin story**.',
            ],
          },
          {
            kind: 'text',
            text: 'On a fresh install with no stories yet, the Welcome screen offers the same flow with **Start a story with…** your featured character.',
          },
        ],
      },
      {
        id: 'stories-continue',
        heading: 'Continue a story',
        blocks: [
          {
            kind: 'text',
            text: "Click a story card (or focus it and press Enter) to continue its current scene. Earlier scenes are in the Story panel's **Scenes** tab.",
          },
        ],
      },
      {
        id: 'stories-actions',
        heading: 'Story actions',
        blocks: [
          { kind: 'text', text: 'The **Story actions** button (•••) on each card offers:' },
          {
            kind: 'list',
            items: [
              '**Pin to top** / **Unpin**.',
              '**Rename**.',
              '**Duplicate full story**: a complete copy, messages and all.',
              '**New with same cast and player**: a fresh start with the same people.',
              '**Delete**: moves the story, with all its scenes, to **Trash** (the link under the library), where you can restore it for 30 days.',
            ],
          },
        ],
      },
      {
        id: 'stories-branches',
        heading: 'Branches',
        blocks: [
          {
            kind: 'text',
            text: "**Fork chat from here** on any reply starts a new branch from that point. Branches show a fork icon in the library, and the play header links back to the **original chat**.",
          },
        ],
      },
    ],
  },
  {
    id: 'scenes',
    title: 'Scenes and long stories',
    group: 'Play',
    icon: 'book',
    summary: 'Why a story is a chain of scenes, the context meter, ending a scene, and reading it all back.',
    keywords: ['scene', 'scenes', 'recap', 'recaps', 'context', 'context window', 'context meter', 'tokens', 'split', 'storyline', 'storylines', 'parallel', 'timeline', 'long story', 'local model', 'end scene', 'chapter', 'history', 'old chats', 'memory', 'memories', 'character memory', 'journal', 'sequel', 'continues from', 'forget', 'rumor', 'rumors', 'claim', 'belief'],
    related: ['stories', 'story-panel', 'campaign'],
    sections: [
      {
        id: 'scenes-why',
        heading: 'Why stories are made of scenes',
        blocks: [
          {
            kind: 'text',
            text: "A story is a chain of scenes. One endless chat eventually grows too big for the model's context (how much it can read at once), and local models run out of room soonest. So each scene is its own short chat.",
          },
          {
            kind: 'text',
            text: 'The story itself carries on across scenes: its relationships, objectives, facts and confirmed consequences come with you into every new scene.',
          },
        ],
      },
      {
        id: 'scenes-meter',
        heading: 'The context meter',
        blocks: [
          {
            kind: 'text',
            text: "A meter in the Classic header or expanded Visual Novel side rail shows how much of the model's context the current scene uses.",
          },
          {
            kind: 'list',
            items: [
              'At about 70% it suggests ending the scene.',
              'At about 85% it says the scene is nearly out of room.',
              'It also suggests a break when the story moves somewhere new or skips ahead in time.',
            ],
          },
          { kind: 'note', text: 'The meter only suggests. The scene ends when you choose **End scene…**.' },
        ],
      },
      {
        id: 'scenes-end',
        heading: 'Ending a scene',
        blocks: [
          {
            kind: 'text',
            text: "**End scene…** is in the Story panel's **Scenes** tab, and on the meter's suggestion chip.",
          },
          {
            kind: 'steps',
            items: [
              'A recap of the scene is drafted for you, along with its open threads. Edit it or rewrite it.',
              'Tick any lasting change you want to **Record as world canon**: it becomes true in every story in this world.',
              'Set up the next scene: its title, its location, and **Who\'s there** (the story\'s lead is always there). Choose whether to continue the story or **Split off a parallel storyline**.',
              '**End scene and continue** opens the new scene.',
            ],
          },
        ],
      },
      {
        id: 'scenes-knowledge',
        heading: 'Who knows what',
        blocks: [
          {
            kind: 'list',
            items: [
              'Characters only hear the recaps of scenes they were present for.',
              'The Game Master hears all of them.',
              'A parallel storyline only knows what happened up to the point where it split off.',
            ],
          },
        ],
      },
      {
        id: 'scenes-memory',
        heading: 'Character memory',
        blocks: [
          {
            kind: 'text',
            text: 'After each reply or Game Master beat, the engine notes what each character saw, heard, or was told. Turn it off in Settings → Generation → **Character memory**.',
          },
          {
            kind: 'list',
            items: [
              'Each character knows only what they witnessed or were told. A line under a message says who will remember it.',
              "Memories stay within the story they happened in. To carry them into a new story, set **Continues from** in the Story panel's **Scenes** tab.",
              "When a scene ends, older memories are condensed into each character's journal.",
              'Cast → a character → **Memories** lists everything they know. **Pin** keeps a memory forever; **Forget** removes it.',
              "What a character only heard (a rumor, a report, an accusation) is kept as a claim, and a hunch as a belief, apart from what they saw firsthand. Neither becomes canon on its own. Rule on them in the Story panel's **Canon** tab: **True**, **False**, **Correct…**, or **Make world canon…**. Your ruling guides the Game Master; the characters keep believing what they heard.",
            ],
          },
        ],
      },
      {
        id: 'scenes-history',
        heading: 'Ended scenes and the Scenes tab',
        blocks: [
          {
            kind: 'list',
            items: [
              'An ended scene is read-only history: a banner says so, and **Continue in Scene N** takes you on to carry on playing.',
              "Story panel → **Scenes** lists the story's scenes by storyline (the story's timeline). Open any of them from there.",
              '**Read the whole story** shows every scene in order, each with its recap.',
            ],
          },
        ],
      },
      {
        id: 'scenes-library',
        heading: 'In the Stories library',
        blocks: [
          {
            kind: 'text',
            text: 'The library shows one card per story, with its scene count. Opening it continues the current scene. Deleting a story moves all its scenes to the trash.',
          },
        ],
      },
      {
        id: 'scenes-old-chats',
        heading: 'Older chats',
        blocks: [
          {
            kind: 'note',
            text: 'Chats from before scenes existed became one-scene stories automatically. Nothing is split for you: end the scene yourself whenever it suits the story.',
          },
        ],
      },
    ],
  },
  {
    id: 'playing',
    title: 'Playing a scene',
    group: 'Play',
    icon: 'message',
    summary: 'Writing turns, and what you can do with each reply.',
    keywords: ['composer', 'send', 'continue', 'swipe', 'regenerate', 'steer', 'rewind', 'edit', 'pin', 'impersonate', 'attach', 'choices', 'quick replies', 'search', 'export'],
    related: ['visual-novel', 'story-panel', 'shortcuts'],
    sections: [
      {
        id: 'play-composer',
        heading: 'Writing your turn',
        blocks: [
          {
            kind: 'text',
            text: 'Type in the composer at the bottom of the scene. Enter sends; Shift+Enter adds a new line. With the box empty, Enter (or the **Continue** button) asks the character to continue their last reply. **Stop** cancels a reply that is still being written.',
          },
          {
            kind: 'list',
            items: [
              '**Attach images or text files** for the model to read.',
              '**Continue the last reply**. After a continue, **Undo last continue** and **Regenerate last continue segment** appear.',
              "**Suggest what you'd say next** drafts your turn for you to edit.",
              '**Reply as** chooses who answers when more than one character is in the scene. When a turn policy decides who speaks, a hint shows there instead.',
            ],
          },
        ],
      },
      {
        id: 'play-replies',
        heading: 'Working with replies',
        blocks: [
          { kind: 'text', text: "Each of a character's replies has its own controls:" },
          {
            kind: 'list',
            items: [
              '**Previous swipe** / **Next swipe** flip between alternative versions. ← and → do the same for the latest reply.',
              '**Regenerate** writes a new version.',
              '**Steer**: tell the model what to fix ("she should pull back"), and it rewrites the reply.',
              '**Pin this moment** keeps it in Pinned moments (Story panel → Notes).',
              '**Fork chat from here** starts a new branch.',
              '**Rewind to here** deletes that message and everything after it.',
              '**Delete** removes one message.',
            ],
          },
          {
            kind: 'text',
            text: 'Click a message to edit it (turn this off with **Click message to edit** in Settings → Appearance). Ctrl/Cmd+Enter saves the edit; Esc cancels.',
          },
        ],
      },
      {
        id: 'play-choices',
        heading: 'Choices and quick replies',
        blocks: [
          {
            kind: 'text',
            text: 'When suggested choices are on (Settings → Generation → Roleplay choices), a few options appear after each reply. **Different options** asks for new ones. Quick replies such as "Let time pass" are one-tap turns you can edit in Settings → Generation → Quick replies.',
          },
        ],
      },
      {
        id: 'play-search',
        heading: 'Search and export',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Search story** in the play header or Visual Novel side rail searches messages and can jump to matches in other stories too.',
              '**Export as HTML transcript** in Classic **Tools** or Visual Novel side controls saves the story as a web page.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'visual-novel',
    title: 'Classic and Visual Novel play',
    group: 'Play',
    icon: 'drama',
    summary: 'Switching views, the dialogue box, choices, Auto, History and Hide UI.',
    keywords: ['vn', 'visual novel', 'transcript', 'classic', 'dialogue box', 'backlog', 'history', 'autoplay', 'auto-advance', 'skip', 'hide ui', 'sprites', 'voice', 'read aloud'],
    related: ['playing', 'cast', 'worlds'],
    sections: [
      {
        id: 'vn-two-views',
        heading: 'Two views of the same story',
        blocks: [
          {
            kind: 'text',
            text: 'Classic is a scrolling transcript under a header. Visual Novel shows full-screen scene art, the characters\' sprites, and a dialogue box. Switching views never changes the story.',
          },
          {
            kind: 'list',
            items: [
              'The masks button switches this story: **Switch to Visual Novel view** in the Classic header, **Switch to transcript view** in the Visual Novel side rail.',
              "New stories follow **Settings → Appearance → Visual Novel mode** (Off, Auto or On). Auto turns Visual Novel on only once the character has expression sprites and the world has scene backgrounds, so you never get an empty stage.",
            ],
          },
          {
            kind: 'note',
            text: "In a world with the Visual novel presentation module switched off, stories start in Classic. Stories begun with the Visual Novel story style start on Auto.",
          },
        ],
      },
      {
        id: 'vn-dialogue',
        heading: 'The dialogue box',
        blocks: [
          {
            kind: 'list',
            items: [
              'Lines type out as they arrive. Click the scene, or press Enter or Space, to show the whole line; do it again to move to the next speaker when a reply has several.',
              "**Next line** at the bottom of the box does the same. When a reply has several speakers, hover or focus the box for a line counter with **Previous line** and **Next**.",
              'The same hover row holds the swipe arrows, **Regenerate**, **Fork chat from here**, **Read this line aloud**, **Auto-voice** (the "A" button, which reads each new reply aloud) and **Pin this moment**.',
            ],
          },
        ],
      },
      {
        id: 'vn-writing',
        heading: 'Writing in Visual Novel',
        blocks: [
          {
            kind: 'text',
            text: 'By default the dialogue box itself becomes your composer: choose **Say something as…** or press Enter, type, and press Enter to send. Esc hands the box back. To keep a composer permanently under the box instead, set **VN input** to Docked in Settings → Appearance.',
          },
        ],
      },
      {
        id: 'vn-choices',
        heading: 'Choices',
        blocks: [
          {
            kind: 'text',
            text: 'Suggested choices appear as a full-screen choice screen (Centered, the default) or as pills above the dialogue box (Docked). Pick the style with **VN choice style** in Settings → Appearance. **Different options** asks for new ones.',
          },
        ],
      },
      {
        id: 'vn-quick-menu',
        heading: 'The side controls',
        blocks: [
          {
            kind: 'list',
            items: [
              'The right-side rail starts collapsed. Its top button expands it to show labels. On a phone, it opens as a drawer.',
              '**Scenery** shows the current place and day or night. **Stage layout** lets you arrange the cast and adjust the stage on desktop.',
              '**Story panel** opens the story details; the masks button switches to the transcript; **Search story** finds messages. The **Tools** section holds tuning, the prompt inspector, the Director and export.',
              '**Auto-advance** (the play icon) keeps the story moving on its own after each reply, once you have had time to read it. It stops by itself after a few turns, when a choice is waiting, or when a reply fails, and it is off again when you switch stories.',
              '**Skip ahead** finishes the current line instantly.',
              '**Hide UI** leaves only the art. Click the scene to bring everything back.',
              '**History** opens the full backlog, with the same per-message controls as Classic. **Close** returns to the scene.',
            ],
          },
          {
            kind: 'note',
            text: '**Reduced motion** (Settings → Appearance) shows lines instantly and turns off scene animations. **VN text speed** sets the typing speed.',
          },
        ],
      },
    ],
  },
  {
    id: 'story-panel',
    title: 'Story panel and Tools',
    group: 'Play',
    icon: 'panel',
    summary: 'Scene, Scenes, Goals, People, Canon, Notes and Scene Rules, plus play tools.',
    keywords: ['story panel', 'scene', 'scenes', 'end scene', 'goals', 'objective', 'people', 'canon', 'notes', "author's note", 'scene rules', 'turn policy', 'tools', 'tuning', 'inspector', 'director', 'export', 'pinned'],
    related: ['playing', 'scenes', 'campaign', 'simulation', 'dating'],
    sections: [
      {
        id: 'sp-open',
        heading: 'Opening the panel',
        blocks: [
          {
            kind: 'text',
            text: '**Story** in the Classic header or **Story panel** in the Visual Novel side rail opens the panel. In Classic, the place and goal pills next to it open the Scene and Goals tabs directly. On a wide screen, **Pin panel** docks it beside the scene; **Close Story panel** hides it.',
          },
        ],
      },
      {
        id: 'sp-tabs',
        heading: 'The tabs',
        blocks: [
          {
            kind: 'list',
            items: [
              "**Scene**: the story's **Location** and **Atmosphere** (**Save scene**; they follow the branch when you rewind), who is **Here now**, and **Choose scenery** when the story has a world. With world simulation you also see the day and time of day and **Key dates**; with dating controls, **Date or event** and **Day planner**.",
              "**Scenes**: the story's scenes by storyline, **End scene…** to wrap up this one and set up the next, and **Read the whole story**. See Scenes and long stories.",
              '**Goals**: give the story an objective (**Set goal**), tick off its tasks, add a **Next step**, **Mark complete**, or open **More goal options** for suggestions and generated tasks.',
              '**People**: everyone in the story. With the Relationships module you see their connection and stats; with dating controls, **Dating details** and **Bag and gifts**.',
              '**Canon**: confirmed world facts, **Record a fact** (it becomes true in every story in this world), and Game Master proposals to **Confirm** or **Reject**. The tab shows a count when proposals are waiting.',
              "**Notes**: the **Author's note** (**Save note**) and your **Pinned moments**; click one to jump to it.",
              '**Scene Rules**: the **Turn policy** (Manual, Round robin, AI picks, @Mention, and Game Master when the world has story rules), which characters are loaded, **GM notes**, **Play As** (switch who you play mid-story) and **More scene rules** (the Scene dialog, which has **Play As** too).',
            ],
          },
        ],
      },
      {
        id: 'sp-tools',
        heading: 'Play tools',
        blocks: [
          { kind: 'text', text: '**Tools** (•••) in the Classic header or the **Tools** section of the Visual Novel side rail holds the less frequent controls:' },
          {
            kind: 'list',
            items: [
              '**Quick tuning: sampler & system prompt** for this session, with a link to the full Settings.',
              '**Inspect prompt & memory**: the prompt the model receives, the story\'s memory summary, and the last reply before and after processing.',
              "**Director: adjust world & relationship state**: time, relationship values, scene flags, memories and plans, for when the story's bookkeeping needs a hand.",
              '**Export as HTML transcript**.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'cast',
    title: 'Cast',
    group: 'Studio',
    icon: 'users',
    summary: 'Characters, their editor, sprites and outfits, and playing a character yourself.',
    keywords: ['characters', 'character editor', 'persona', 'personas', 'player character', 'play as', 'you only', 'how others see you', 'player', 'sprites', 'expressions', 'outfits', 'voice', 'import', 'export', 'card', 'generate'],
    related: ['worlds', 'visual-novel', 'dating'],
    sections: [
      {
        id: 'cast-tabs',
        heading: 'One kind of card',
        blocks: [
          {
            kind: 'text',
            text: 'Everyone in Cast is the same kind of card, and any of them can be played by you or voiced by the AI. The **Player** filter shows the cards you play, and **New player character** starts one.',
          },
        ],
      },
      {
        id: 'cast-create',
        heading: 'Adding characters',
        blocks: [
          {
            kind: 'list',
            items: [
              '**New character** opens an empty editor. Its Character tab has **Import card** (.json or .png), **Import pack**, **Generate with AI** and **Start from a template**.',
              'An existing character can be saved out with **Export JSON**, **Export PNG** or **Export pack** (card, sprites, gallery and bound world in one file).',
              '**Maximum Immersion** applies an immersive preset in one click. It also changes some global settings (the sampler preset and Visual Novel mode); its section in the Advanced tab explains exactly what.',
            ],
          },
        ],
      },
      {
        id: 'cast-editor',
        heading: 'The character editor',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Character**: avatar, **Name**, **World** (bind a world for scene backgrounds and a shared clock), **Description**, **Scenario**, **First message**, **Alternate greetings**, and **Playing this character** (see below).',
              '**Background**: life details such as occupation, home, birthday, likes, goals and boundaries.',
              '**Behavior**: personality, example messages and behavioral rules.',
              '**Knowledge**: **Private memory** only this character sees, and **Character lore** that travels with the card.',
              "**Relationships**: social connections. When the character's world has dating tools, a Dating section adds the CG gallery, gift preferences, relationship starters, touch & limits, and an opt-out from date / event mode.",
              '**World Life**: weather preferences, a daily **Schedule**, and **Outreach** (how often they text you first; off by default).',
              '**Presentation**: expressions, outfits, sound effects and voice.',
              '**Advanced**: character prompts, prompt overrides and metadata.',
            ],
          },
          { kind: 'text', text: 'Finish with **Save changes** (or **Create character**).' },
        ],
      },
      {
        id: 'cast-presentation',
        heading: 'Sprites, expressions and outfits',
        blocks: [
          {
            kind: 'list',
            items: [
              "**Expressions** holds art per expression. Visual Novel mode shows the one matching each reply's mood; a blank slot falls back to the avatar. The small number is the warmth needed to unlock it.",
              '**Outfit** chips switch which outfit the grid is editing. **Base** is the default art; type a **New outfit** name and press + to add another. Each outfit has a name and **Unlocks at warmth**, and any expression it lacks falls back to Base.',
              '**Generate expression set with AI** fills the grid using the Images model from Settings → Models and services.',
              '**Voice** and **Voice fingerprint** shape how the character sounds and speaks.',
            ],
          },
          {
            kind: 'note',
            text: 'Sprites come from the character, but scene backgrounds come from a world. An unbound character plays in front of a plain gradient.',
          },
        ],
      },
      {
        id: 'cast-players',
        heading: 'Playing a character',
        blocks: [
          {
            kind: 'text',
            text: "Open a character's editor and find **Playing this character** on the Character tab:",
          },
          {
            kind: 'list',
            items: [
              '**You only** marks a card that only you ever play. The AI never voices it, and it stays out of cast pickers and the Game Master\'s scene cast.',
              '**How others see you** is what the other characters know about you while you play this card. Leave it blank to use the **Description**. Private memory and notes are never shared while you play it.',
            ],
          },
          {
            kind: 'list',
            items: [
              'Choose who you play in **Start a story → Who you play**, or play as an unnamed **You**.',
              'Switch mid-story with **Play As** in **Story panel → Scene Rules** or the Scene dialog (**More scene rules**). The card you take over stops being voiced by the AI; the card you leave goes back to the AI unless it is **You only**. The story\'s main character is always played by the AI.',
            ],
          },
          {
            kind: 'note',
            text: 'Older personas were converted automatically (after a backup): one linked to a character became that character, and a standalone persona became a **You only** card.',
          },
        ],
      },
    ],
  },
  {
    id: 'worlds',
    title: 'Worlds',
    group: 'Studio',
    icon: 'globe',
    summary: 'Settings, their modules, locations and scenery, and music.',
    keywords: ['world', 'template', 'modules', 'scenery', 'backgrounds', 'locations', 'music', 'bgm', 'canon', 'world lore', 'prompts', 'freeform', 'dating sim'],
    related: ['campaign', 'simulation', 'dating', 'lore'],
    sections: [
      {
        id: 'worlds-intro',
        heading: 'What a world is',
        blocks: [
          {
            kind: 'text',
            text: "A world is a shared setting: its tone, rules, lore, places and music. Any number of characters can live in one; assign it in the character's editor. **New world** starts from a template (Freeform RP, Visual Novel or Dating Sim).",
          },
        ],
      },
      {
        id: 'worlds-tabs',
        heading: 'Editor tabs',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Overview**: cover, **Name**, **Description**, **Rules**, **Template** and the **World modules**.',
              '**Story Rules**: the campaign ruleset and moves. Only when story rules are on.',
              '**Canon**: **World lore** (lorebook entries for this setting) and **World canon** (facts every story here treats as true).',
              '**Locations**: scene backgrounds.',
              '**Simulation**: custom scene flags, authored **Rules**, and the **World clock**. Only with world simulation.',
              '**Relationships**: relationship thresholds, plus the dating catalogs when dating tools are on. Only with relationships.',
              '**Presentation**: **Background music**. Only with visual novel presentation.',
              '**Advanced**: **World prompts** shared by every character here.',
            ],
          },
          { kind: 'text', text: 'Finish with **Save changes** (or **Create world**).' },
        ],
      },
      {
        id: 'worlds-modules',
        heading: 'World modules',
        blocks: [
          { kind: 'text', text: 'Overview → **World modules** chooses which tools a world uses:' },
          {
            kind: 'list',
            items: [
              '**Story rules**: Off, **Guided outcomes**, or **Roll for outcomes**. See Campaign rules and GM turns.',
              '**Relationships**: tracks connection and relationship stats with each character.',
              '**Dating tools**: dates, gifts, intimacy and CGs. Needs Relationships.',
              '**Visual novel presentation**: scene art, sprites and music.',
              '**World simulation**: a shared clock with days, time of day, weather and schedules.',
            ],
          },
          {
            kind: 'note',
            text: 'Romance emphasis follows the template and dating tools: a Dating Sim world puts dating controls up front, other templates let romance develop naturally, and it is off when dating tools are off. Switching a module off keeps its settings for later.',
          },
        ],
      },
      {
        id: 'worlds-locations',
        heading: 'Locations and scenery',
        blocks: [
          {
            kind: 'list',
            items: [
              'Pick a scenery set, then upload or **Generate with AI** art for each place. Add your own places by name.',
              'The moon toggle adds a night version, shown once the world clock reaches evening or night. The star marks the opening scene, and the number under each is the warmth needed before it can appear.',
              '**Bulk upload by filename** matches files such as place_day.png and place_night.png to places.',
            ],
          },
          {
            kind: 'text',
            text: "During play the model tags where each reply happens. **Choose scenery** (Story panel → Scene) or **Scenery** (Visual Novel side rail) pins a place on this branch until you choose **Follow the story**.",
          },
        ],
      },
      {
        id: 'worlds-music',
        heading: 'Music',
        blocks: [
          {
            kind: 'text',
            text: 'Presentation → **Background music** takes one looping track per scene mood, plus a **Default**. The matching track crossfades in as the mood changes. You can listen to them outside a scene in Media → Soundtrack.',
          },
          {
            kind: 'note',
            text: 'Music is silent until you raise **Music volume** in Settings → Appearance → Background music; it starts at zero.',
          },
        ],
      },
    ],
  },
  {
    id: 'lore',
    title: 'Lore',
    group: 'Studio',
    icon: 'book',
    summary: 'Standalone lorebooks, and where else lore can live.',
    keywords: ['world info', 'lorebook', 'keys', 'entries', 'scope', 'keywords', 'memory'],
    related: ['worlds', 'cast'],
    sections: [
      {
        id: 'lore-books',
        heading: 'Lorebooks',
        blocks: [
          {
            kind: 'text',
            text: 'Lore (titled World Info on the page) holds standalone lorebooks: locations, factions, history, rules. An entry is added to the prompt when its keys come up in the story. **New book** creates one; click a book to edit it and **All books** to go back.',
          },
          {
            kind: 'list',
            items: [
              '**Scope** chooses where the book is available: every story, or only specific worlds or characters.',
              'Each entry has **Keys**, **Content**, and optional timing and placement: secondary keys, order, position, depth, unlock warmth, chance, delay, sticky, cooldown and inclusion groups.',
              "The book's **Token budget** and **Recursive scanning** control how much lore fits and whether entries can trigger each other.",
            ],
          },
        ],
      },
      {
        id: 'lore-elsewhere',
        heading: 'Lore in other places',
        blocks: [
          {
            kind: 'list',
            items: [
              "**World lore** in a world's Canon tab applies to every character living there.",
              "**Character lore** in a character's Knowledge tab travels with that character's card.",
              'To see which lore reached the model, use **Tools → Inspect prompt & memory** during play.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'media',
    title: 'Media',
    group: 'Studio',
    icon: 'gallery',
    summary: 'Story CGs and unlock progress, plus each world\'s soundtrack.',
    keywords: ['gallery', 'cg', 'cgs', 'unlocks', 'progress', 'images', 'soundtrack', 'music', 'main theme'],
    related: ['dating', 'worlds'],
    sections: [
      {
        id: 'media-cgs',
        heading: 'Story CGs and unlock progress',
        blocks: [
          {
            kind: 'text',
            text: 'Story CGs are special scene images (relationship scenes and endings) that unlock as a story\'s warmth rises and it reaches key beats. Media shows how many of each character\'s CGs you have unlocked, with hints for the rest. **Progress for** filters it to one of the cards you play; click an unlocked CG to view it larger.',
          },
          {
            kind: 'note',
            text: "CGs are authored per character in Cast → Relationships → CG gallery, which appears when the character's world has dating tools. **Edit CGs** next to a character goes straight there.",
          },
        ],
      },
      {
        id: 'media-soundtrack',
        heading: 'Soundtrack',
        blocks: [
          {
            kind: 'text',
            text: "Listen to each world's mood tracks outside a scene, **Main theme** first. **Edit tracks** opens the world's Presentation tab. Portraits and sprites live in Cast → Presentation, and scene backgrounds in a world's Locations.",
          },
        ],
      },
    ],
  },
  {
    id: 'writers-room',
    title: "Writer's Room",
    group: 'Tools',
    icon: 'sparkles',
    summary: 'Build a playable roleplay or brainstorm, review and prepare stories.',
    keywords: ['assistant', 'brainstorm', 'continuity', 'summary', 'encounter', 'generate character', 'outline', 'build roleplay', 'guided setup'],
    related: ['cast', 'lore', 'worlds', 'stories'],
    sections: [
      {
        id: 'writer-what',
        heading: 'What it is for',
        blocks: [
          {
            kind: 'text',
            text: "The Writer's Room is a conversation with the model that sits outside your stories: brainstorm, review your notes, or prepare the next scene. Past conversations are listed on the side; **New** starts another.",
          },
        ],
      },
      {
        id: 'writer-guided',
        heading: 'Build a roleplay',
        blocks: [
          {
            kind: 'text',
            text: 'Choose **Build a roleplay** to walk through an idea, world, public lore, cast, rules and opening scene. Use an existing Writer’s Room conversation as the idea, write the fields yourself, or use **Suggest world, lore, cast & opening** for an editable draft. Review before **Create & start story** saves the world and characters and opens the first playable scene. The draft stays on this device until creation succeeds.',
          },
          {
            kind: 'text',
            text: 'Choose a check preset in **Rules & opening** to give your player character a starting sheet, and optionally set a first goal for the Story panel. Customize the world’s moves and stats in Worlds and the saved sheet in Cast after setup. Put secrets in **GM only notes**, not public lore.',
          },
        ],
      },
      {
        id: 'writer-starters',
        heading: 'Starting points',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Brainstorm**: Character, Location, Faction, Story arc.',
              '**Review & prep**: Continuity check, Summary, Dangling threads, Encounter prep.',
            ],
          },
          {
            kind: 'text',
            text: 'A starter fills in a brief you can edit before sending. Writer’s Room searches saved worlds, cast, lore, and story text on this device and sends relevant excerpts to your configured model. Name a world or story to narrow the search. Open **Local sources used** below a reply to inspect its evidence. To change a saved character, name them and say what to change, for example \u201cgive Ash\u2019s character sheet stats for this world\u201d: **Update this character** drafts it (stats for that world\u2019s rules, with a reason for each) on a card you can edit, and **Apply** saves it. Enter sends, Shift+Enter adds a line, **Stop** cancels.',
          },
        ],
      },
      {
        id: 'writer-build',
        heading: 'Building characters and stories',
        blocks: [
          {
            kind: 'text',
            text: 'When a request reads like a character or a story, the room offers **Build this as a character** or **Write this as a full story**. A built character comes with **Save to characters**, which adds it to Cast.',
          },
        ],
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    group: 'Tools',
    icon: 'settings',
    summary: 'Connection, Appearance, Generation, Voice, Images and Data.',
    keywords: ['preferences', 'options', 'model', 'backend', 'theme', 'sampler', 'tts', 'image generation', 'backup', 'restore', 'music volume'],
    related: ['getting-started', 'visual-novel'],
    sections: [
      {
        id: 'settings-tabs',
        heading: 'The tabs',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Connection**: which backend writes replies (a local server or a hosted provider) and its model.',
              '**Appearance**: theme presets and colors, chat style, layout (including **VN text speed**), behavior toggles (**Reduced motion**, **Click message to edit**, **Visual Novel mode**, **VN choice style**, **VN input**), sound effects, **Background music** (**Music volume**), custom CSS, and saving or sharing a theme.',
              '**Generation**: story systems and background assists, context and memory, objectives, relationship tracking, roleplay choices, quick replies, writing style, advanced prompt controls, and the sampler.',
              '**Voice**: text-to-speech for Read this line aloud and Auto-voice.',
              '**Images**: the image generator used by the Generate with AI buttons.',
              '**Data**: **Download backup** of everything, and **Restore from backup…** (this replaces all current data).',
            ],
          },
          { kind: 'text', text: 'On a phone the tabs are a drop-down at the top of Settings.' },
        ],
      },
      {
        id: 'settings-overrides',
        heading: 'Global settings and per-world choices',
        blocks: [
          {
            kind: 'text',
            text: "Settings are the defaults. A world's modules and a story's own choices (for example its Visual Novel toggle) take priority over them.",
          },
        ],
      },
    ],
  },
  {
    id: 'campaign',
    title: 'Campaign rules and GM turns',
    group: 'Optional systems',
    icon: 'dice',
    summary: 'Guided outcomes, moves and rolls, and the Game Master turn policy.',
    condition: 'Only in worlds with Story rules turned on.',
    keywords: ['campaign', 'pbta', 'd20', 'fate', 'starfinder', 'sheet', 'rules', 'ruleset', 'moves', 'roll', 'dice', '2d6', 'game master', 'gm', 'proposals', 'guided', 'mechanical'],
    related: ['worlds', 'story-panel'],
    sections: [
      {
        id: 'campaign-setup',
        heading: 'Turning it on',
        blocks: [
          {
            kind: 'text',
            text: 'In a world, Overview → World modules → **Story rules** chooses **Guided outcomes** or **Roll for outcomes**. In **Story Rules**, load a core-check preset or import a campaign file, choose the resolver, and edit the sheet fields and moves. Presets include 2d6 moves, D&D 5e SRD d20 checks, Starfinder 2e four-degree checks, Fate Core dice, and a custom 3d6 roll-under check. You can export the edited campaign as a file.',
          },
        ],
      },
      {
        id: 'campaign-guided',
        heading: 'Guided outcomes',
        blocks: [
          {
            kind: 'text',
            text: "The ruleset is guidance for the narrator, who judges outcomes in its spirit. Nothing is rolled or checked.",
          },
          {
            kind: 'note',
            text: 'Guided mode is not rules enforcement. Character sheets can still be saved, but the app does not roll or track hit points and other resources in guided mode.',
          },
        ],
      },
      {
        id: 'campaign-rolls',
        heading: 'Moves and rolls',
        blocks: [
          {
            kind: 'text',
            text: 'Build fields in **World → Story Rules → Character sheet builder**, assign one to each move, then open **Cast → Sheet** and choose the world’s ruleset for the character. One character can keep sheets for several worlds without changing their home world. Rolls use the selected sheet’s saved score, bonus, or roll-under target; the server checks it before rolling. Older stories with no sheet can enter a value manually. D20 and Fate checks compare with a difficulty or opposition: a world-authored fixed target takes precedence, and the GM sets a scene-specific target before asking you to roll. For a roll you start yourself, enter the target before rolling. With **Roll for outcomes** and at least one move, **Make a move / roll** appears above the composer. If the GM identifies a move after you describe an action, play pauses at **Roll required**.',
          },
          { kind: 'note', text: 'A failed check is recorded and cannot be turned into success by GM narration. Presets implement core checks, not complete published rules or character options; add your own sheet fields, move effects, and world rules for the rest of the game.' },
        ],
      },
      {
        id: 'campaign-gm',
        heading: 'Game Master turns',
        blocks: [
          {
            kind: 'text',
            text: 'New mechanical stories start with the **Game Master** turn policy. For an older story, set **Story panel → Scene Rules → Turn policy** to **Game Master** so it can identify checks before characters answer. Explicit rolls use the GM even if that story still uses Manual turns. The GM narrates, decides who acts next, can bring characters into the scene, and may start a new story branch.',
          },
          {
            kind: 'list',
            items: [
              'Each GM turn shows a card with the mode, pacing and who acts.',
              'Lasting changes arrive as proposals, for **World canon** or **This branch**. **Confirm** or **Reject** them on the card or in Story panel → Canon.',
              '**GM notes** (Scene Rules) and the world\'s Game Master continuity notes are seen only by the GM.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'simulation',
    title: 'World simulation',
    group: 'Optional systems',
    icon: 'clock',
    summary: 'The world clock, calendar, day planner, weather and schedules.',
    condition: 'Only in worlds with World simulation turned on.',
    keywords: ['clock', 'time', 'day', 'phase', 'morning', 'night', 'calendar', 'key dates', 'birthday', 'holiday', 'day planner', 'energy', 'actions', 'weather', 'schedule', 'outreach', 'triggers', 'scene flags'],
    related: ['worlds', 'dating', 'story-panel'],
    sections: [
      {
        id: 'sim-clock',
        heading: 'The world clock',
        blocks: [
          {
            kind: 'text',
            text: 'A simulated world keeps one clock shared by all its stories: the day, weekday and season, the time of day (morning, afternoon, evening, night), and the weather.',
          },
          {
            kind: 'list',
            items: [
              'Worlds → Simulation → **World clock** shows it and can **Advance** to the next time of day.',
              'In play, Story panel → Scene shows the day and time of day, and **Tools → Director** can **Advance to next phase**.',
            ],
          },
          {
            kind: 'note',
            text: 'World simulation is on by default for Visual Novel and Dating Sim worlds and off for Freeform RP. Change it in the world\'s Overview → World modules.',
          },
        ],
      },
      {
        id: 'sim-calendar',
        heading: 'Calendar and day planner',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Key dates** (Story panel → Scene) lists upcoming birthdays, anniversaries and holidays.',
              "**Day planner** (Story panel → Scene) opens **Plan your day**: pick an activity for this part of the day. Each day has a limited number of actions, and the Visual Novel status card can show how many are left.",
            ],
          },
          { kind: 'note', text: 'The day planner appears with the dating controls. See Relationships and dating.' },
        ],
      },
      {
        id: 'sim-life',
        heading: 'Weather, schedules and outreach',
        blocks: [
          {
            kind: 'list',
            items: [
              "Weather follows the clock; a character's **Weather preferences** (World Life tab) color their mood.",
              "A character's **Schedule** says where they are at each time of day; the play header shows what they are up to.",
              '**Outreach** lets a character message you first now and then. It is off by default.',
            ],
          },
        ],
      },
      {
        id: 'sim-rules',
        heading: 'Scene flags and rules',
        blocks: [
          {
            kind: 'text',
            text: 'The Simulation tab also holds **Custom scene flags** (story beats the app watches for, beyond the built-in four) and **Rules**: when every condition holds, the actions run once, for example remembering a fact after a confession.',
          },
        ],
      },
    ],
  },
  {
    id: 'dating',
    title: 'Relationships and dating',
    group: 'Optional systems',
    icon: 'heart',
    summary: 'Connection, dates and events, gifts, intimacy and CGs.',
    condition: 'Only in worlds with Relationships (and, for dating, Dating tools) turned on.',
    keywords: ['romance', 'relationship', 'warmth', 'affection', 'date', 'hangout', 'event', 'gifts', 'bag', 'shop', 'intimacy', 'unlocks', 'cg', 'wardrobe', 'content rating'],
    related: ['worlds', 'simulation', 'media'],
    sections: [
      {
        id: 'dating-when',
        heading: 'When these appear',
        blocks: [
          {
            kind: 'list',
            items: [
              "**Relationships** tracks warmth and relationship stats; you see them in Story panel → People.",
              '**Dating tools** add dates, gifts, intimacy and CGs. In a Dating Sim world the date and day-planner controls are shown by default. Elsewhere romance develops naturally and those controls stay tucked away until you turn on **Show date and day planner controls** (Relationship panel → More).',
              'A character can opt out of dates entirely (Cast → Relationships → Opt out of date / event mode).',
            ],
          },
        ],
      },
      {
        id: 'dating-panel',
        heading: 'The Relationship panel',
        blocks: [
          {
            kind: 'text',
            text: "**Dating details** in Story panel → People opens it. **Overview** shows the relationship's stats; **Unlocks** shows scene flags, intimate unlocks, milestones and what's coming up; **Shop** appears when the world has something to buy; **More** holds this story's own settings and what it remembers.",
          },
        ],
      },
      {
        id: 'dating-dates',
        heading: 'Dates, events and gifts',
        blocks: [
          {
            kind: 'list',
            items: [
              '**Date or event** (Story panel → Scene) starts a date, hangout or event. While one is live, warmth holds still and a live rapport read shows instead; end it from the same panel.',
              "Buy gifts in the Shop, then give them with **Bag and gifts** (Story panel → People). A character's gift preferences shape the reaction.",
            ],
          },
        ],
      },
      {
        id: 'dating-intimacy',
        heading: 'Intimacy and CGs',
        blocks: [
          {
            kind: 'list',
            items: [
              "Intimate actions unlock in the Relationship panel as warmth grows. The world's **Content rating** (Relationships tab) and the character's **Touch & limits** decide what is offered.",
              'CGs are authored per character (Cast → Relationships → CG gallery). When one triggers it fills the Visual Novel stage, and it is collected in Media.',
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'shortcuts',
    title: 'Keyboard shortcuts',
    group: 'Tools',
    icon: 'keyboard',
    summary: 'Every shortcut in one place.',
    keywords: ['keys', 'hotkeys', 'keyboard', 'shortcut', 'palette', 'search'],
    related: ['playing', 'visual-novel'],
    sections: [
      {
        id: 'keys-global',
        heading: 'Anywhere',
        blocks: [
          {
            kind: 'keys',
            rows: [
              { keys: 'Ctrl/Cmd K', description: 'Search everywhere: jump to a story, cast member, world or section. Arrow keys and Enter pick a result.' },
              { keys: '?', description: 'Show the keyboard shortcuts sheet (outside a text box).' },
              { keys: 'Esc', description: 'Close the open panel or dialog.' },
              { keys: 'Tab / Shift+Tab', description: 'Move between controls. Focus stays inside an open dialog.' },
            ],
          },
        ],
      },
      {
        id: 'keys-play',
        heading: 'While playing',
        blocks: [
          {
            kind: 'keys',
            rows: [
              { keys: 'Enter', description: 'Send your turn. With an empty box, continue the last reply.' },
              { keys: 'Shift+Enter', description: 'New line in the composer.' },
              { keys: '← →', description: "Flip between versions of the character's latest reply (outside a text box)." },
              { keys: 'Ctrl/Cmd+Enter', description: 'Save a message you are editing. Esc cancels the edit.' },
            ],
          },
        ],
      },
      {
        id: 'keys-vn',
        heading: 'Visual Novel',
        blocks: [
          {
            kind: 'keys',
            rows: [
              { keys: 'Enter / Space', description: 'Show the whole line, then move to the next speaker.' },
              { keys: 'Enter', description: 'Take over the dialogue box to write (Inline VN input).' },
              { keys: 'Esc', description: 'Hand the dialogue box back without sending.' },
            ],
          },
        ],
      },
      {
        id: 'keys-tour',
        heading: 'Guided tour',
        blocks: [
          {
            kind: 'keys',
            rows: [
              { keys: '→ / ←', description: 'Next or previous step.' },
              { keys: 'Esc', description: 'Skip the tour.' },
            ],
          },
        ],
      },
    ],
  },
]

const TOPIC_BY_ID = new Map<string, HelpTopic>(HELP_TOPICS.map((topic) => [topic.id, topic]))

export const DEFAULT_HELP_TOPIC: HelpTopicId = 'getting-started'

export function isHelpTopicId(value: unknown): value is HelpTopicId {
  return typeof value === 'string' && TOPIC_BY_ID.has(value)
}

/** The topic, or the default one for an unknown id — a stale deep link should still open Help. */
export function getHelpTopic(id: string | null | undefined): HelpTopic {
  return (id && TOPIC_BY_ID.get(id)) || TOPIC_BY_ID.get(DEFAULT_HELP_TOPIC)!
}

/** Strips the `**bold**` markers, for search and plain-text use. */
export function plainHelpText(text: string): string {
  return text.replace(/\*\*/g, '')
}

/** Splits `**bold**` markup into runs. An unmatched marker is left as literal text. */
export function parseHelpInline(text: string): { text: string; strong: boolean }[] {
  const runs: { text: string; strong: boolean }[] = []
  let rest = text
  while (rest.length > 0) {
    const open = rest.indexOf('**')
    const close = open === -1 ? -1 : rest.indexOf('**', open + 2)
    if (open === -1 || close === -1) {
      runs.push({ text: rest, strong: false })
      break
    }
    if (open > 0) runs.push({ text: rest.slice(0, open), strong: false })
    runs.push({ text: rest.slice(open + 2, close), strong: true })
    rest = rest.slice(close + 2)
  }
  return runs.filter((run) => run.text.length > 0)
}

export function blockText(block: HelpBlock): string {
  switch (block.kind) {
    case 'text':
    case 'note':
      return plainHelpText(block.text)
    case 'list':
    case 'steps':
      return block.items.map(plainHelpText).join(' ')
    case 'keys':
      return block.rows.map((row) => `${row.keys} ${row.description}`).join(' ')
  }
}

export interface HelpSearchResult {
  topicId: HelpTopicId
  topicTitle: string
  /** Absent for a match on the topic itself (title, summary, keywords). */
  sectionId?: string
  heading: string
  snippet: string
}

function snippetAround(text: string, term: string, radius = 70): string {
  const index = text.toLowerCase().indexOf(term)
  if (index === -1) return text.length > radius * 2 ? `${text.slice(0, radius * 2).trimEnd()}…` : text
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + term.length + radius)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`
}

/**
 * Case-insensitive search: every word of the query must appear in the section (its heading, its
 * text, or its topic's title and keywords). Topic-level matches come first, then sections in order.
 */
export function searchHelp(query: string, topics: readonly HelpTopic[] = HELP_TOPICS, limit = 30): HelpSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []
  const topicHits: HelpSearchResult[] = []
  const sectionHits: HelpSearchResult[] = []
  for (const topic of topics) {
    const topicText = [topic.title, topic.summary, ...(topic.keywords ?? [])].join(' ').toLowerCase()
    if (terms.every((term) => topicText.includes(term))) {
      topicHits.push({ topicId: topic.id, topicTitle: topic.title, heading: topic.title, snippet: topic.summary })
    }
    for (const section of topic.sections) {
      const body = section.blocks.map(blockText).join(' ')
      const haystack = `${topic.title} ${(topic.keywords ?? []).join(' ')} ${section.heading} ${body}`.toLowerCase()
      if (terms.every((term) => haystack.includes(term))) {
        const focus = terms.find((term) => body.toLowerCase().includes(term)) ?? terms[0]
        sectionHits.push({
          topicId: topic.id,
          topicTitle: topic.title,
          sectionId: section.id,
          heading: section.heading,
          snippet: snippetAround(body, focus),
        })
      }
    }
  }
  return [...topicHits, ...sectionHits].slice(0, limit)
}
