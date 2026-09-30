import { CHAPTER_RECAP_GUIDANCE } from '@/lib/story/chapterRecap'
import { JOURNAL_GUIDANCE } from '@/lib/memory/journal'
import { SCENE_RECAP_GUIDANCE } from '@/lib/story/recapWriter'
import { SCRIBE_GUIDANCE } from '@/lib/memory/scribe'
import { GM_STYLE_GUIDANCE } from '@/lib/world/gm'
import type { WorldCard } from '@/lib/types'
import { promptOverride, type TunablePromptId } from './promptOverrides'

/**
 * The engine prompts Writer's Room can tune per world, as the editor shows them: what each one
 * drives, the engine's default guidance, and the guardrails that stay in the prompt whatever the
 * override says. Only the guidance is ever replaced; the guardrails and the reply format the
 * engine parses live in the prompt builders themselves.
 */
export interface TunablePrompt {
  id: TunablePromptId
  label: string
  /** What this prompt drives in play. */
  drives: string
  defaultText: string
  /** Kept in the prompt whatever the override says. Shown locked. */
  guardrails: string[]
  /** A placeholder the builder fills in, when there is one. */
  placeholder?: string
}

export const TUNABLE_PROMPTS: TunablePrompt[] = [
  {
    id: 'gm-style',
    label: 'Game Master style',
    drives: 'How the GM paces a scene, brings in leads, and picks who reacts.',
    defaultText: GM_STYLE_GUIDANCE,
    guardrails: [
      'Characters with cards are played by their own agents. The GM never writes them.',
      'The player\'s character is never written or chosen for the player.',
      'Recorded rolls are binding. The GM never invents dice or changes a result.',
      'Characters act only on what they have learned. Rumors are not facts.',
      'The reply format the engine reads.',
    ],
  },
  {
    id: 'scribe',
    label: 'Memory scribe',
    drives: 'What the characters remember from each exchange.',
    defaultText: SCRIBE_GUIDANCE,
    guardrails: [
      'Only what is in the messages. Nothing invented.',
      'What someone only said, or believes, is never recorded as fact.',
      'A memory belongs only to those who witnessed it.',
      'The reply format the engine reads.',
    ],
  },
  {
    id: 'scene-recap',
    label: 'Scene recap',
    drives: 'The recap a scene leaves for the scenes after it.',
    defaultText: SCENE_RECAP_GUIDANCE,
    guardrails: ['Only events in the transcript. Binding check results win over prose.', 'The reply format the engine reads.'],
  },
  {
    id: 'chapter-recap',
    label: 'Chapter recap',
    drives: 'The recap a chapter leaves when it ends.',
    defaultText: CHAPTER_RECAP_GUIDANCE,
    guardrails: ['Only events in the scene recaps. Nothing invented.', 'The reply format the engine reads.'],
  },
  {
    id: 'journal',
    label: 'Character journal',
    drives: 'How a character\'s older memories are folded into their private journal.',
    defaultText: JOURNAL_GUIDANCE,
    guardrails: ['Only what the character remembers. Nothing invented.', 'The reply format the engine reads.'],
    placeholder: '{name} is the character.',
  },
]

export function tunablePrompt(id: TunablePromptId): TunablePrompt {
  return TUNABLE_PROMPTS.find((p) => p.id === id)!
}

/** The guidance a world's prompts use: its override, or the engine default. */
export function promptGuidance(world: Pick<WorldCard, 'promptOverrides'> | undefined, id: TunablePromptId): string {
  return promptOverride(world?.promptOverrides, id) ?? tunablePrompt(id).defaultText
}
