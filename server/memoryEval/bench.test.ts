import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import fixtures from './fixtures/cases.json'
import { evaluateCase, parseCase, summarize } from './bench'
import { parseOptions, run } from './runner'

describe('recall bench', () => {
  it('has twenty synthetic cases covering all six required categories', () => {
    const cases = fixtures.map(parseCase)
    expect(cases).toHaveLength(20)
    expect(new Set(cases.map((c) => c.id)).size).toBe(20)
    expect(new Set(cases.map((c) => c.category))).toEqual(new Set([
      'wording', 'connections', 'emotion', 'place', 'knowledge', 'branch',
    ]))
  })

  it('keeps every knowledge and branch case as a must-never-regress check', () => {
    for (const module of ['off', 'on'] as const) for (const c of fixtures.map(parseCase).filter((c) => ['knowledge', 'branch'].includes(c.category))) {
      expect(c.mustNeverRegress, c.id).toBe(true)
      expect(c.forbiddenIds.length, c.id).toBeGreaterThan(0)
      const result = evaluateCase(c, { module })
      expect(result.hit, c.id).toBe(true)
      expect(result.forbidden, c.id).toEqual([])
      expect(result.picks).toEqual(evaluateCase({ ...c, memories: c.memories.filter((m) => !c.forbiddenIds.includes(m.id)) }, { module }).picks)
    }
  })

  it('picks the forbidden memory when each protected case loses its guard', () => {
    for (const module of ['off', 'on'] as const) for (const c of fixtures.map((raw) => parseCase(structuredClone(raw))).filter((c) => c.mustNeverRegress)) {
      for (const m of c.memories.filter((m) => c.forbiddenIds.includes(m.id))) {
        if (c.category === 'branch') {
          m.chatId = c.scene.chatId
          delete m.toldVia
        }
        if (c.id === 'knowledge-retired') m.active = true
        else if (c.id === 'knowledge-folded') delete m.consolidatedFor
        else {
          m.knownBy = [...new Set([...m.knownBy, c.scene.speakerId])]
          m.witnesses = [...new Set([...m.witnesses, c.scene.speakerId])]
        }
      }
      const result = evaluateCase(c, { module })
      expect(result.forbidden, c.id).toEqual(c.forbiddenIds)
      expect(result.hit, c.id).toBe(false)
    }
  })

  it('reports actual picks and reasons at the production budget deterministically', () => {
    const c = parseCase(fixtures[0])
    const result = evaluateCase(c)
    expect(result.budgetTokens).toBe(350)
    expect(result).toEqual(evaluateCase(c))
    expect(result.picks.length).toBeGreaterThan(0)
    expect(result.picks[0].reasons.score).toEqual(expect.any(Number))
    expect(result.usedTokens).toBeLessThanOrEqual(350)
    const empty = evaluateCase(c, { budgetTokens: 0 })
    expect(empty.missing).toEqual(c.expectedIds)
    expect(empty.hit).toBe(false)
  })

  it('counts partial recall separately from case hits and forbidden picks', () => {
    const c = parseCase(fixtures[0])
    const result = evaluateCase(c)
    const pickedId = result.picks[0].memory.id
    const otherId = c.memories.find((m) => !result.picks.some((p) => p.memory.id === m.id))!.id
    const partial = evaluateCase({ ...c, expectedIds: [pickedId, otherId], forbiddenIds: [pickedId] })
    expect(partial.hit).toBe(false)
    expect(summarize([partial])).toMatchObject({ cases: 1, hits: 0, expected: 2, recalled: 1, recall: 0.5, violations: 1 })
    expect(summarize([]).recall).toBe(0)
  })

  it('rejects malformed cases rather than silently measuring the wrong thing', () => {
    const c = structuredClone(fixtures[0])
    expect(() => parseCase({ ...c, expectedIds: ['missing'] })).toThrow()
    expect(() => parseCase({ ...c, expectedIds: [] })).toThrow()
    expect(() => parseCase({ ...c, memories: [...c.memories, c.memories[0]] })).toThrow()
    expect(() => parseCase({ ...c, scene: { ...c.scene, speakerId: 'missing' } })).toThrow()
    expect(() => parseCase({ ...c, memories: [{ ...c.memories[0], knownBy: 'everyone' }] })).toThrow()
    expect(() => parseCase({ ...c, chats: [] })).toThrow()
  })

  it('accepts local cases, budget options and module-on ranking', () => {
    expect(parseOptions(['--cases', '.memory-eval/private', '--budget', '120', '--module', 'off']))
      .toMatchObject({ casesPath: '.memory-eval/private', budgetTokens: 120, module: 'off' })
    const c = parseCase(fixtures[0])
    expect(parseOptions(['--module', 'on']).module).toBe('on')
    expect(evaluateCase(c, parseOptions(['--module', 'on'])).picks.length).toBeGreaterThan(0)
    expect(() => evaluateCase(c, parseOptions(['--budget', '-1']))).toThrow(/Budget/)
    expect(() => evaluateCase(c, parseOptions(['--budget', 'NaN']))).toThrow(/Budget/)
    expect(() => parseOptions(['--cases'])).toThrow()
    expect(() => parseOptions(['--unknown'])).toThrow()
  })

  it('prints misses as measurements but exits nonzero for protected regressions', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recall-runner-'))
    const file = path.join(dir, 'case.json')
    const c = parseCase(fixtures[0])
    try {
      const lines: string[] = []
      fs.writeFileSync(file, JSON.stringify(c))
      expect(run(['--cases', dir, '--budget', '0'], (s) => lines.push(s))).toBe(0)
      expect(lines.join('\n')).toContain('MISS wording-bridge')
      expect(lines.join('\n')).toContain('recall at budget: 0/1 (0.0%)')
      fs.writeFileSync(file, JSON.stringify({ ...c, mustNeverRegress: true }))
      expect(run(['--cases', file, '--budget', '0'], () => {})).toBe(1)
      fs.writeFileSync(file, JSON.stringify({ ...c, forbiddenIds: ['routine-6'] }))
      expect(run(['--cases', file], () => {})).toBe(1)
      fs.writeFileSync(file, JSON.stringify([c, c]))
      expect(() => run(['--cases', file], () => {})).toThrow(/Duplicate/)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})


it('improves emotional and place recall with the module on', () => {
  for (const category of ['emotion', 'place']) {
    const cases = fixtures.map(parseCase).filter((c) => c.category === category)
    const off = summarize(cases.map((c) => evaluateCase(c)))
    const on = summarize(cases.map((c) => evaluateCase(c, { module: 'on' })))
    expect(on.recalled, category).toBeGreaterThan(off.recalled)
    expect(on.hits, category).toBe(cases.length)
  }
})
