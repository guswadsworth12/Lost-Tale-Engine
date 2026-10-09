import { expect, it, vi, beforeEach } from 'vitest'
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), commit: vi.fn(), cancel: vi.fn(), generate: vi.fn() }))
vi.mock('../api/client', () => ({ consolidationApi: mocks }))
vi.mock('../api/services', () => ({ resolveJob: (_: string, s: any) => s.textModel ? { service: {}, model: 'stub' } : undefined, createTextClient: () => ({ generate: mocks.generate }) }))
import { NO_SECRETS } from '../accounts/secrets'
import { runConsolidation } from './runConsolidation'
import type { WorldCard } from '../types'
const world = { modules: { deepMemory: true }, memoryConsolidation: { enabled: true, dailyCap: 1 } } as WorldCard
const model = { textModel: { serviceId: 'stub', model: 'stub' }, services: [] }
beforeEach(() => { vi.clearAllMocks(); mocks.prepare.mockResolvedValue({ id: 'reservation', prompt: 'Known memory clusters.' }); mocks.generate.mockResolvedValue('{"summaries":["A known summary."]}'); mocks.commit.mockResolvedValue({}); mocks.cancel.mockResolvedValue(undefined) })
it('uses exactly one stub model call for a run and no calls when off, unset or capped', async () => {
  expect(await runConsolidation(world, 'scene', 'mara', model, NO_SECRETS)).toBe(true)
  expect(mocks.generate).toHaveBeenCalledTimes(1)
  expect(mocks.commit).toHaveBeenCalledWith('scene', 'reservation', '{"summaries":["A known summary."]}')
  await runConsolidation({ ...world, modules: { deepMemory: false } }, 'scene', 'mara', model, NO_SECRETS)
  await runConsolidation({ ...world, memoryConsolidation: undefined }, 'scene', 'mara', model, NO_SECRETS)
  await runConsolidation(world, 'scene', 'mara', { ...model, textModel: null }, NO_SECRETS)
  mocks.prepare.mockResolvedValue(null)
  await runConsolidation(world, 'scene', 'mara', model, NO_SECRETS)
  expect(mocks.generate).toHaveBeenCalledTimes(1)
})
it('releases a reservation and reports failure without a fallback call', async () => {
  mocks.generate.mockRejectedValue(new Error('model unavailable'))
  await expect(runConsolidation(world, 'scene', 'mara', model, NO_SECRETS)).rejects.toThrow('model unavailable')
  expect(mocks.generate).toHaveBeenCalledTimes(1)
  expect(mocks.cancel).toHaveBeenCalledWith('scene', 'reservation')
  expect(mocks.commit).not.toHaveBeenCalled()
})
