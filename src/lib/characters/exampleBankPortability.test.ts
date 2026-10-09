import { expect, it, vi } from 'vitest'
import { blankCharacterData, wrapCardV2 } from './cardSpec'
import { cardWithExampleBank, importCharacterFile } from './importExport'
import type { Character } from './cardSpec'
import { planExport, planImport } from '../../../server/packPlan'
const created = vi.hoisted(() => ({ payload: undefined as unknown }))
vi.mock('@/lib/api/client', () => ({ charactersApi: { create: async (payload: unknown) => { created.payload = payload; return { id: 'imported', ...(payload as object) } } }, worldsApi: {} }))
import { buildCharacterPack, importCharacterPack } from './pack'
const bank = [{ id: 'everyday', situations: ['everyday'] as const, text: '<START>\n{{char}}: The harbor is quiet.', enabled: true }]
const character = { id: 'mara', card: { ...blankCharacterData(), name: 'Mara' }, worldId: 'harbor', exampleBank: bank, createdAt: 1, updatedAt: 1 } as unknown as Character
it('round-trips banks through a V2 JSON card extension and clears stale extension data', async () => {
  const card = cardWithExampleBank(character.card, character.exampleBank)
  const imported = await importCharacterFile({ name: 'mara.json', type: 'application/json', text: async () => JSON.stringify(wrapCardV2(card)) } as File)
  expect(imported.exampleBank).toEqual(bank)
  expect(cardWithExampleBank(card, []).extensions).not.toHaveProperty('lost_tales_example_bank')
})
it('round-trips character packs with the same bank', async () => {
  const pack = await buildCharacterPack(character)
  expect(pack.character.exampleBank).toEqual(bank)
  await importCharacterPack(JSON.parse(JSON.stringify(pack)))
  expect(created.payload).toMatchObject({ exampleBank: bank })
})
it('round-trips banks in world-pack template fields without opting into private memory', () => {
  const plan = planExport({ world: { id: 'harbor', name: 'Harbor' }, characters: [{ ...character }], lorebooks: [] })
  expect(plan.content.characters[0].exampleBank).toEqual(bank)
  let id = 0
  const imported = planImport(JSON.parse(JSON.stringify(plan.content)), { worlds: [], characters: [] }, { ownerUserId: 'synthetic-owner', now: 1, newId: () => `new-${++id}`, mediaPath: () => undefined })
  expect(imported.characters[0].row?.exampleBank).toEqual(bank)
})
