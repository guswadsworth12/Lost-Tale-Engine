import { expect, it } from 'vitest'
import fixtures from './fixtures/cases.json'
import { evaluateCase, parseCase } from './bench'
import { memoryBlock } from '../../src/lib/memory/rank'

// Captured from merged Phase 0 before changing ranking. Never update to accommodate module-off changes.
it('preserves Phase 0 picks and prompt memory text on every case with the module off', () => {
  const baseline = fixtures.map(parseCase).map((c) => {
    const result = evaluateCase(c, { module: 'off' })
    return {
      id: c.id,
      picks: result.picks.map((p) => p.memory.id),
      text: memoryBlock(c.cast.find((v) => v.id === c.scene.speakerId)!.name, result.picks.map((p) => p.memory), undefined, c.scene.speakerId),
    }
  })
  expect(baseline).toMatchSnapshot()
})
