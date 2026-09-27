import { describe, expect, it } from 'vitest'
import { expressionForFile, matchFolder, mergeById, planSpriteLibrary } from './spriteLibrary'

const cast = [
  { id: 'a1', name: 'Ivo Brand' },
  { id: 'v1', name: 'Ashen, the Last Warden' },
  { id: 'r1', name: 'Wren Calloway' },
  { id: 'e1', name: 'Maya' },
]

describe('sprite library planning', () => {
  it('maps every file to an expression, keeping labels outside the defaults as custom', () => {
    expect(expressionForFile('Loving.png')).toEqual({ id: 'love', label: 'Loving', custom: false })
    expect(expressionForFile('Happy.png')).toMatchObject({ id: 'happy', custom: false })
    expect(expressionForFile('Battle Cry.webp')).toEqual({ id: 'battle-cry', label: 'Battle Cry', custom: true })
  })

  it('matches folders by name or first name and reports everything else', () => {
    expect(matchFolder('ashen', cast)).toMatchObject({ character: { id: 'v1' }, by: 'first-name' })
    expect(matchFolder('maya', cast)).toMatchObject({ character: { id: 'e1' }, by: 'name' })
    expect(matchFolder('marlow', cast)).toEqual({ error: 'no character with this name or first name' })
    expect(matchFolder('marlow', cast, { marlow: 'Maya' })).toMatchObject({ character: { id: 'e1' }, by: 'override' })
  })

  it('plans base and named outfits, accounts for every image, and never drops a folder silently', () => {
    const plan = planSpriteLibrary(
      [
        { name: 'ivo', outfits: [{ name: 'default', files: ['Happy.png', 'Loving.png'] }, { name: 'festival', files: ['Happy.png', 'Battle Cry.png', 'notes.txt'] }] },
        { name: 'marlow', outfits: [{ name: 'wisp', files: ['Neutral.png'] }] },
        { name: 'default', outfits: [] },
      ],
      cast,
    )
    expect(plan.totalImages).toBe(5)
    expect(plan.unmatched).toEqual([{ folder: 'marlow', files: 1, reason: 'no character with this name or first name' }])
    expect(plan.empty).toEqual(['default'])
    expect(plan.skippedFiles).toEqual(['ivo/festival/notes.txt'])
    const [set] = plan.sets
    expect(set.outfits).toEqual([{ id: 'festival', label: 'festival' }])
    expect(set.customExpressions).toEqual([{ id: 'battle-cry', label: 'Battle Cry' }])
    expect(set.sprites.map((s) => s.key)).toEqual(['happy', 'love', 'festival--happy', 'festival--battle-cry'])
    expect(plan.sets.reduce((n, s) => n + s.sprites.length, 0) + plan.unmatched.reduce((n, u) => n + u.files, 0)).toBe(plan.totalImages)
  })

  it('merging keeps existing authored outfits and gates untouched', () => {
    expect(mergeById([{ id: 'dress', label: 'Formal', unlockAffection: 40 }], [{ id: 'dress', label: 'dress' }, { id: 'coat', label: 'coat' }]))
      .toEqual([{ id: 'dress', label: 'Formal', unlockAffection: 40 }, { id: 'coat', label: 'coat' }])
  })
})
