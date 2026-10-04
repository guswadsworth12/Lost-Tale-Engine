/**
 * The starter story (#40): Hollowmere Station's first scene, as the setup wizard's "Play the starter
 * world" starts it. Data only, with type-only imports, so the server's seed (`server/seedContent.ts`,
 * which re-exports it) and the browser read the same definition.
 */
import type { GmPlayedCharacter, SetEvent } from '../world/gm.ts'

export const HOLLOWMERE_WORLD_ID = 'a0000000-0000-4000-8000-000000000007'
export const HOLLOWMERE_MARA_ID = 'a0000000-0000-4000-8000-000000000008'
export const HOLLOWMERE_TAVI_ID = 'a0000000-0000-4000-8000-000000000009'
export const HOLLOWMERE_PASSENGER_ID = 'a0000000-0000-4000-8000-000000000010'
export const HOLLOWMERE_ROWAN_ID = 'a0000000-0000-4000-8000-000000000011'

export const STARTER_STORY = {
  worldId: HOLLOWMERE_WORLD_ID,
  leadCharacterId: HOLLOWMERE_MARA_ID,
  participantIds: [HOLLOWMERE_TAVI_ID, HOLLOWMERE_PASSENGER_ID],
  playerCharacterId: HOLLOWMERE_ROWAN_ID,
  title: 'Hollowmere Station',
  sceneTitle: 'The last train',
  openingNarration: 'The last train reaches Hollowmere at 11:47. Its doors open under a glass canopy. Fog drifts between the wet platform stones and the marsh beyond the rails. Mara Vale waits with an oil lantern. Tavi Rook puts a mail satchel on the bench. A hooded passenger steps down last, holding a brass ticket with a blank name line. The signal lamp by the marsh is dark. Mara asks Rowan to help the passenger off the train and out of the fog.',
  openingBackgroundId: 'platform',
  gmNotes: 'The hooded passenger is Nell Fen, a surveyor who lost her recent memory in the marsh fog when the signal went dark. Keep her identity hidden until the player relights the lamp. She is voiced by the GM until that exact set event. Then her own agent takes over. The restored memory still contains no introductions; she does not know anyone present by name until it is said aloud near her after the lamp is lit. Relighting the lamp succeeds as written without a roll. In the final scene, the brass marker and Nell’s satchel at the marsh edge confirm her route; let her decide whether to stay or leave.',
  setEvents: [{
    id: 'relight-signal',
    trigger: 'The signal lamp is relit',
    outcome: 'The signal lamp catches. A small marsh light answers across the reeds. Letters appear on the passenger’s brass ticket: Nell Fen. She remembers that she went to survey the washed-out culvert two nights ago, lost the path in the fog, and reached the last train. She can now speak for herself.',
    consequence: 'Nell Fen has her name and recent memory back. The signal lamp remains lit and the last train has a safe route out.',
    match: ['light|relight|ignite|kindle', 'lamp|signal'],
  }] satisfies SetEvent[],
  gmPlayed: [{
    characterId: HOLLOWMERE_PASSENGER_ID,
    as: 'a hooded passenger with a blank ticket, cold and missing their recent memory; answer simple questions without revealing their name',
    until: 'relight-signal',
  }] satisfies GmPlayedCharacter[],
  // About three scenes. The first is the chapter's goal when the story starts; the rest guide the GM.
  chapter: [
    { title: 'The last train', goal: 'Bring the passenger inside, inspect the blank ticket, and learn that the signal lamp is dark.' },
    { title: 'The signal box', goal: 'Find a dry wick and oil, then relight the signal lamp to restore the passenger’s memory.' },
    { title: 'The marsh edge', goal: 'Follow the answering light, find Nell’s satchel and survey marker, and return safely with the mystery resolved.' },
  ],
}

export type StarterStory = typeof STARTER_STORY
