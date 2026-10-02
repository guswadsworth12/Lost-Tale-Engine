import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  HOLLOWMERE_WORLD_ID, HOLLOWMERE_BACKGROUND_KEYS, HOLLOWMERE_EXPRESSIONS,
  HOLLOWMERE_FOX_EXPRESSIONS, hollowmereCharacters, hollowmereWorld, STARTER_STORY,
} from './seedContent.ts'
import { buildGmPrompt, gmHeld, parseGmTurn, type GmContext } from '../src/lib/world/gm.ts'
import { stillStrangers, strangersFor } from '../src/lib/story/acquaintance.ts'
import { resolveExpressionSprite } from '../src/lib/vn/expressions.ts'
import { resolveSceneBackground } from '../src/lib/vn/resolveBackground.ts'
import type { Chat } from '../src/lib/types.ts'

let dataDir: string
let previousDataDir: string | undefined
let previousLoadEnvFile: typeof process.loadEnvFile

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lost-tales-hollowmere-'))
  previousDataDir = process.env.LOST_TALES_DATA_DIR
  previousLoadEnvFile = process.loadEnvFile
  process.env.LOST_TALES_DATA_DIR = dataDir
  process.loadEnvFile = () => {}
})

afterAll(async () => {
  const { db } = await import('./db.ts')
  db.close()
  process.loadEnvFile = previousLoadEnvFile
  if (previousDataDir === undefined) delete process.env.LOST_TALES_DATA_DIR
  else process.env.LOST_TALES_DATA_DIR = previousDataDir
  fs.rmSync(dataDir, { recursive: true, force: true })
})

describe('Hollowmere starter seed', () => {
  it('ships the complete art set within the image budget', () => {
    const root = path.join('seed', 'hollowmere')
    const files = [
      ...['backgrounds', 'backgrounds-night'].flatMap((folder) => HOLLOWMERE_BACKGROUND_KEYS.map((key) => path.join(root, folder, `${key}.png`))),
      ...hollowmereCharacters.flatMap((character, index) => {
        const slug = ['mara', 'tavi', 'passenger', 'rowan'][index]
        const dir = path.join(root, 'sprites', slug)
        const keys = index === 1 ? [...HOLLOWMERE_EXPRESSIONS, ...HOLLOWMERE_FOX_EXPRESSIONS] : HOLLOWMERE_EXPRESSIONS
        return [path.join(dir, 'avatar.png'), ...keys.map((key) => path.join(dir, `${key}.png`))]
      }),
    ]
    expect(files).toHaveLength(48)
    let total = 0
    for (const file of files) {
      const bytes = fs.readFileSync(file)
      const avatar = path.basename(file) === 'avatar.png'
      const background = file.includes(`${path.sep}backgrounds`)
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(avatar ? [512, 512] : background ? [1216, 832] : [832, 1216])
      if (!background) expect(bytes[25]).toBe(6) // RGBA, so sprites really have transparency.
      expect(bytes.length).toBeLessThanOrEqual((background ? 600 : 400) * 1024)
      total += bytes.length
    }
    expect(total).toBeLessThanOrEqual(20 * 1024 * 1024)
  })

  it('seeds fresh installs, skips repeats, and back-fills an existing install once', async () => {
    const { runSeedIfNeeded } = await import('./seed.ts')
    const { worldStore, characterStore } = await import('./db.ts')
    const platformArt = path.join(dataDir, 'avatars', 'worlds', HOLLOWMERE_WORLD_ID, 'backgrounds', 'platform.png')
    const originalArt = fs.readFileSync(path.join('seed', 'hollowmere', 'backgrounds', 'platform.png'))

    runSeedIfNeeded()
    expect(worldStore.get(HOLLOWMERE_WORLD_ID)?.name).toBe('Hollowmere Station')
    expect(hollowmereCharacters.map((c) => (characterStore.get(c.id)?.card as { name?: string } | undefined)?.name))
      .toEqual(['Mara Vale', 'Tavi Rook', 'Hooded Passenger', 'Rowan Hale'])
    expect(fs.readFileSync(platformArt)).toEqual(originalArt)
    for (const key of HOLLOWMERE_BACKGROUND_KEYS) {
      for (const folder of ['backgrounds', 'backgrounds-night']) {
        expect(fs.existsSync(path.join(dataDir, 'avatars', 'worlds', HOLLOWMERE_WORLD_ID, folder, `${key}.png`))).toBe(true)
      }
    }
    for (const character of hollowmereCharacters) {
      const dir = path.join(dataDir, 'avatars', 'characters', character.id)
      expect(fs.existsSync(path.join(dir, 'avatar.png'))).toBe(true)
      for (const key of HOLLOWMERE_EXPRESSIONS) expect(fs.existsSync(path.join(dir, 'sprites', `${key}.png`))).toBe(true)
    }
    for (const key of HOLLOWMERE_FOX_EXPRESSIONS) {
      expect(fs.existsSync(path.join(dataDir, 'avatars', 'characters', hollowmereCharacters[1].id, 'sprites', `${key}.png`))).toBe(true)
    }
    expect(STARTER_STORY.setEvents[0].id).toBe(STARTER_STORY.gmPlayed[0].until)

    fs.writeFileSync(platformArt, 'user replacement')
    runSeedIfNeeded()
    expect(fs.readFileSync(platformArt, 'utf8')).toBe('user replacement')

    worldStore.remove(HOLLOWMERE_WORLD_ID)
    for (const character of hollowmereCharacters) characterStore.remove(character.id)
    runSeedIfNeeded()
    expect(worldStore.get(HOLLOWMERE_WORLD_ID)?.name).toBe('Hollowmere Station')
    expect(fs.readFileSync(platformArt)).toEqual(originalArt)
    runSeedIfNeeded()
    expect(worldStore.list().filter((world) => world.id === HOLLOWMERE_WORLD_ID)).toHaveLength(1)
    expect(characterStore.list().filter((character) => hollowmereCharacters.some((seed) => seed.id === character.id))).toHaveLength(4)
  })

  it('gives the passenger to the GM until the no-roll lamp event, then starts them as a stranger', () => {
    const gmPlayed = STARTER_STORY.gmPlayed.map((played) => ({
      id: played.characterId,
      name: 'Hooded Passenger',
      as: played.as,
      until: STARTER_STORY.setEvents.find((event) => event.id === played.until),
    }))
    const context: GmContext = {
      campaign: hollowmereWorld.campaign!,
      worldName: hollowmereWorld.name,
      worldDescription: hollowmereWorld.description,
      canonFacts: hollowmereWorld.canonFacts!.map((fact) => fact.text),
      branchConsequences: [],
      scenery: 'Platform at night',
      roster: [
        { id: hollowmereCharacters[0].id, name: 'Mara Vale' },
        { id: hollowmereCharacters[1].id, name: 'Tavi Rook' },
      ],
      playerName: 'Rowan Hale',
      transcript: [],
      playerAction: 'I relight the signal lamp.',
      setEvents: STARTER_STORY.setEvents,
      gmPlayed,
      maxSpeakers: 3,
    }
    const prompt = buildGmPrompt(context)
    expect(prompt.user).toContain('The signal lamp is relit')
    expect(prompt.user).toContain('Characters you play yourself for now')
    expect(gmHeld(STARTER_STORY.gmPlayed, [])).toHaveLength(1)
    const turn = parseGmTurn(JSON.stringify({ narration: 'The lamp catches and Nell remembers.', speakers: ['Mara Vale'] }), context, () => 'turn-1')
    expect(turn.adjudication).toMatchObject({ source: 'set_event', setEventId: 'relight-signal' })
    expect(turn.handedOver?.[0].id).toBe(hollowmereCharacters[2].id)
    expect(turn.speakerIds).toContain(hollowmereCharacters[2].id)
    expect(gmHeld(STARTER_STORY.gmPlayed, ['relight-signal'])).toHaveLength(0)

    const passengerId = hollowmereCharacters[2].id
    const stranger = strangersFor(passengerId, [hollowmereCharacters[0].id, hollowmereCharacters[1].id], hollowmereCharacters[3].id, 100)
    const nameOf = (id: string) => hollowmereCharacters.find((character) => character.id === id)?.card.name
    expect(stillStrangers(passengerId, stranger, [], nameOf)).toHaveLength(3)
    expect(stillStrangers(passengerId, stranger, [{ speakerId: hollowmereCharacters[0].id, text: '"I am Mara Vale."', createdAt: 101, presentIds: [passengerId] }], nameOf))
      .toEqual([hollowmereCharacters[1].id, hollowmereCharacters[3].id])
  })

  it('resolves the night platform and fox form on the Visual Novel stage', () => {
    expect(resolveSceneBackground({ chat: {} as Chat, world: hollowmereWorld, affection: 0, night: true,
      narration: STARTER_STORY.openingNarration })).toMatchObject({
      id: 'platform',
      url: hollowmereWorld.backgroundsNight?.platform,
    })
    const courier = hollowmereCharacters[1]
    expect(resolveExpressionSprite(courier.sprites, undefined, courier.avatarDataUrl, 'happy', 0, 'fox'))
      .toBe(courier.sprites?.['fox--happy'])
  })
})
