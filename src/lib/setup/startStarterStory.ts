import { chatsApi, messagesApi } from '@/lib/api/client'
import type { ChatBackend } from '@/lib/api/chatBackend'
import type { Character } from '@/lib/characters/cardSpec'
import { createChat } from '@/lib/chat/createChat'
import { backgroundLabel } from '@/lib/vn/backgrounds'
import { GM_NAME, GM_SPEAKER_ID, type GmTurn } from '@/lib/world/gm'
import type { Chat, WorldCard } from '@/lib/types'
import { STARTER_STORY, type StarterStory } from './starterStory'

/** Who the player is in the starter story: its own traveller card, or one they just made. */
export interface StarterPlayer {
  id: string
  name: string
  /** The starter's own card (Rowan), whom the cast already expects by name. */
  isStarterCard: boolean
}

/**
 * The GM's notes for the starter story: its own notes, the chapter's later scenes as the plan, and,
 * when the player made their own traveller, that they arrive in the starter card's place.
 */
export function starterGmNotes(story: StarterStory, player: StarterPlayer, starterName: string): string {
  const plan = story.chapter.map((scene, i) => `${i + 1}. ${scene.title}: ${scene.goal}`).join('\n')
  const stand = player.isStarterCard
    ? ''
    : `\n\nThe player plays ${player.name}, the traveller on the last train in ${starterName}'s place: the new inventory clerk Mara expects. Call them ${player.name}, never ${starterName}.`
  return `${story.gmNotes}${stand}\n\nThis chapter's scenes, in order:\n${plan}`
}

/** The opening narration, naming the player's own traveller where it names the starter card. */
export function starterOpening(story: StarterStory, player: StarterPlayer, starterName: string): string {
  if (player.isStarterCard) return story.openingNarration
  const firstName = starterName.split(/\s+/)[0]
  return story.openingNarration.replace(new RegExp(`\\b${firstName}\\b`, 'g'), player.name)
}

/** The GM's first turn: the opening narration, nobody asked to answer yet, so the player moves first. */
export function starterOpeningTurn(world: Pick<WorldCard, 'campaign'>, narration: string): GmTurn {
  return {
    mode: world.campaign?.mode ?? 'guided',
    ruleset: world.campaign?.ruleset ?? '',
    narration,
    pacing: 'linger',
    speakerIds: [],
    proposals: [],
    scenery: '',
  }
}

/** Everything the starter scene sets on the new chat beyond what `createChat` does. */
export function starterChatPatch(story: StarterStory, chat: Pick<Chat, 'assistOverrides'>, world: WorldCard, gmNotes: string): Partial<Chat> {
  return {
    title: story.title,
    sceneTitle: story.sceneTitle,
    gmNotes,
    setEvents: story.setEvents,
    gmPlayed: story.gmPlayed,
    // The Game Master runs every turn, and the story opens on the stage.
    scene: { turnPolicy: 'gm', location: backgroundLabel(story.openingBackgroundId, world) },
    assistOverrides: { ...chat.assistOverrides, visualNovelMode: true },
  }
}

/**
 * Starts the starter story (#40, "Play the starter world"): Hollowmere Station's first scene with its
 * cast, the GM running turns and voicing the passenger until the lamp is lit, the set event, the
 * chapter's goal, and the GM's opening narration on the platform. Returns the new scene.
 */
export async function startStarterStory(opts: {
  world: WorldCard
  characters: Character[]
  player: StarterPlayer
  client?: ChatBackend
  story?: StarterStory
}): Promise<Chat> {
  const { world, characters, player, client, story = STARTER_STORY } = opts
  const lead = characters.find((c) => c.id === story.leadCharacterId)
  if (!lead) throw new Error('The starter world’s cast is missing. Restore it from Cast, or pick another character.')
  const playerCard = characters.find((c) => c.id === player.id)
  const starterName = characters.find((c) => c.id === story.playerCharacterId)?.card.name ?? 'Rowan Hale'

  const chat = await createChat({
    character: lead,
    world,
    player: playerCard,
    participantIds: story.participantIds.filter((id) => characters.some((c) => c.id === id)),
    // The GM opens the scene instead of the lead's greeting.
    greetingIndex: -1,
    mode: 'visual_novel',
    client,
  })
  await chatsApi.update(chat.id, starterChatPatch(story, chat, world, starterGmNotes(story, player, starterName)))
  await chatsApi.updateChapter(chat.id, { goal: story.chapter[0].goal })
  const narration = starterOpening(story, player, starterName)
  await messagesApi.create({
    chatId: chat.id,
    role: 'char',
    name: GM_NAME,
    speakerId: GM_SPEAKER_ID,
    text: narration,
    gm: starterOpeningTurn(world, narration),
    scene: { background: story.openingBackgroundId },
  })
  return chat
}
