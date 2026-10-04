import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Character } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'

// Stubbed so these tests check what the starter story writes, not the HTTP layer.
vi.mock('@/lib/api/client', () => ({
  chatsApi: {
    create: vi.fn(async (input: unknown) => ({ id: 'chat-1', createdAt: 0, updatedAt: 0, ...(input as object) })),
    update: vi.fn(async () => ({})),
    updateChapter: vi.fn(async () => ({})),
  },
  messagesApi: { create: vi.fn(async (input: unknown) => ({ id: 'msg-1', ...(input as object) })), update: vi.fn() },
}))

import { chatsApi, messagesApi } from '@/lib/api/client'
import { GM_NAME, GM_SPEAKER_ID } from '@/lib/world/gm'
import { STARTER_STORY } from './starterStory'
import { startStarterStory, starterGmNotes, starterOpening } from './startStarterStory'

const card = (id: string, name: string, extra: Partial<Character> = {}): Character => ({
  id, createdAt: 0, updatedAt: 0,
  card: { name, description: '', personality: '', scenario: '', first_mes: `Hello from ${name}.`, mes_example: '' },
  ...extra,
})

const world: WorldCard = {
  id: STARTER_STORY.worldId,
  name: 'Hollowmere Station',
  description: '',
  template: 'visual_novel',
  campaign: { ruleset: 'Hollowmere Story', mode: 'guided', resolver: 'pbta', relationships: true, dating: false, moves: [] },
  lorebook: { name: '', entries: [], token_budget: 512, scan_depth: 8 },
  createdAt: 0,
  updatedAt: 0,
}

const cast = [
  card(STARTER_STORY.leadCharacterId, 'Mara Vale', { worldId: world.id }),
  ...STARTER_STORY.participantIds.map((id, i) => card(id, i ? 'Hooded Passenger' : 'Tavi Rook', { worldId: world.id })),
  card(STARTER_STORY.playerCharacterId, 'Rowan Hale', { worldId: world.id, playerOnly: true }),
]
const rowan = { id: STARTER_STORY.playerCharacterId, name: 'Rowan Hale', isStarterCard: true }

beforeEach(() => vi.clearAllMocks())

describe('the starter story', () => {
  it('starts the first scene as written: cast, GM turns, set event, GM-played passenger, goal, Visual Novel, and the GM opening', async () => {
    const chat = await startStarterStory({ world, characters: cast, player: rowan })
    expect(chat.id).toBe('chat-1')

    expect(vi.mocked(chatsApi.create).mock.calls[0][0]).toMatchObject({
      characterId: STARTER_STORY.leadCharacterId,
      participants: STARTER_STORY.participantIds,
      playerCharacterId: STARTER_STORY.playerCharacterId,
    })
    expect(vi.mocked(chatsApi.update).mock.calls[0][1]).toMatchObject({
      title: 'Hollowmere Station',
      sceneTitle: 'The last train',
      setEvents: STARTER_STORY.setEvents,
      gmPlayed: STARTER_STORY.gmPlayed,
      scene: { turnPolicy: 'gm' },
      assistOverrides: { visualNovelMode: true },
    })
    expect(vi.mocked(chatsApi.updateChapter)).toHaveBeenCalledWith('chat-1', { goal: STARTER_STORY.chapter[0].goal })

    // The GM opens the scene; Mara's own greeting isn't posted.
    const messages = vi.mocked(messagesApi.create).mock.calls.map(([m]) => m as { name: string; speakerId?: string; text: string; gm?: { speakerIds: string[] }; scene?: { background?: string } })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ name: GM_NAME, speakerId: GM_SPEAKER_ID, text: STARTER_STORY.openingNarration, scene: { background: 'platform' } })
    expect(messages[0].gm?.speakerIds).toEqual([])
  })

  it('gives the GM the later scenes as its plan', () => {
    const notes = starterGmNotes(STARTER_STORY, rowan, 'Rowan Hale')
    expect(notes.startsWith(STARTER_STORY.gmNotes)).toBe(true)
    expect(notes).toContain('2. The signal box: ')
    expect(notes).toContain('3. The marsh edge: ')
  })

  it("puts the player's own traveller in Rowan's place, in the opening and for the GM", () => {
    const own = { id: 'mine', name: 'Ash', isStarterCard: false }
    expect(starterOpening(STARTER_STORY, own, 'Rowan Hale')).toContain('Mara asks Ash to help the passenger')
    expect(starterOpening(STARTER_STORY, own, 'Rowan Hale')).not.toContain('Rowan')
    expect(starterGmNotes(STARTER_STORY, own, 'Rowan Hale')).toContain("The player plays Ash, the traveller on the last train in Rowan Hale's place")
  })

  it('refuses plainly when the starter cast was deleted', async () => {
    await expect(startStarterStory({ world, characters: cast.slice(1), player: rowan })).rejects.toThrow(/starter world’s cast is missing/)
    expect(chatsApi.create).not.toHaveBeenCalled()
  })
})
