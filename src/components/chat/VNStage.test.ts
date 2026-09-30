import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement, type ComponentProps } from 'react'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat, StoredMessage, WorldCard } from '@/lib/types'
import { GM_SPEAKER_ID } from '@/lib/world/gm'
import { VNStage } from './VNStage'

const person = (id: string, name: string) => ({ id, card: { name }, createdAt: 1, updatedAt: 1 }) as unknown as Character
const [ash, bea, cole] = [person('ash', 'Ash'), person('bea', 'Bea'), person('cole', 'Cole')]
const line = (id: string, speakerId: string | undefined, text: string, extra: Partial<StoredMessage> = {}) =>
  ({ id, chatId: 'c1', role: speakerId ? 'char' : 'user', speakerId, name: speakerId, text, createdAt: Number(id.slice(1)), ...extra }) as unknown as StoredMessage

function render(messages: StoredMessage[], chat: Partial<Chat> = {}, world?: Partial<WorldCard>) {
  const props = {
    character: ash, participantCharacters: [bea, cole],
    chat: { id: 'c1', characterId: 'ash', participants: ['bea', 'cole'], title: 'Supper', createdAt: 1, updatedAt: 1, ...chat } as Chat,
    world: world as WorldCard | undefined,
    messages, streamingText: '', generatingMessageId: null, composerSlot: null,
    onSwipe: () => {}, onRegenerate: () => {}, onSteer: () => {}, onDelete: () => {}, onRewind: () => {}, onEdit: () => {}, onFork: () => {}, onTogglePin: () => {},
  } as ComponentProps<typeof VNStage>
  return renderToStaticMarkup(createElement(VNStage, props))
}

/** Each figure on stage: whether a phone shows it (only one isn't hidden below `md`), and its placement. */
const figures = (html: string) => [...html.matchAll(/class="(absolute left-1\/2 bottom-0[^"]*)"[^>]*style="([^"]*)"/g)].map((m) => ({ phone: !m[1].includes('hidden md:block'), style: m[2] }))

describe('the Visual Novel stage on a phone', () => {
  it('frames exactly one character, the speaker, while someone is speaking', () => {
    const shown = figures(render([line('m1', 'bea', 'Hello.')]))
    expect(shown).toHaveLength(3)
    expect(shown.filter((f) => f.phone)).toHaveLength(1)
  })

  it('keeps the last speaker framed during the player\'s own line and narration', () => {
    const html = render([line('m1', 'cole', 'Evening.'), line('m2', undefined, 'I sit down.')])
    expect(figures(html).filter((f) => f.phone)).toHaveLength(1)
    const narrated = render([line('m1', 'cole', 'Evening.'), line('m2', GM_SPEAKER_ID, 'Rain on the window.')])
    expect(figures(narrated).filter((f) => f.phone)).toHaveLength(1)
  })

  it('frames the lead before anyone has spoken', () => {
    expect(figures(render([])).filter((f) => f.phone)).toHaveLength(1)
  })
})

describe('the Visual Novel stage on a wide screen', () => {
  it('keeps everyone else where they stand when the speaker changes', () => {
    const styleOf = (html: string, index: number) => figures(html)[index].style
    const beaSpeaks = render([line('m1', 'bea', 'Hello.')])
    const coleSpeaks = render([line('m1', 'bea', 'Hello.'), line('m2', 'cole', 'Hi.')])
    // Ash never spoke: the same spot, the same size, either way.
    expect(styleOf(coleSpeaks, 0)).toBe(styleOf(beaSpeaks, 0))
    expect(styleOf(coleSpeaks, 2)).not.toBe(styleOf(beaSpeaks, 2))
  })

  it('stands the cast where a saved layout puts them', () => {
    const layout = { id: 'l1', name: 'Table', width: 90, depth: 50, focus: 'light' as const, updatedAt: 1, cues: { ash: { x: 0.3, depth: 0.2 }, bea: { x: 0.5, depth: 0.8 }, cole: { x: 0.7, depth: 0.2 } } }
    const html = render([line('m1', 'bea', 'Hello.')], { stage: { layoutId: 'l1' } }, { id: 'w1', stageLayouts: [layout] })
    expect(figures(html)[0].style).toContain('--stage-x:30%')
    expect(figures(html)[2].style).toContain('--stage-x:70%')
  })
})
