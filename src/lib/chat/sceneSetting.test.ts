import { describe, expect, it } from 'vitest'
import { sceneSettingFrom } from './sceneSetting'

const label = (id: string) => ({ 'city-gate': 'City Gate', 'guild-library': 'Guild Library', tavern: 'Tavern' })[id] ?? id
const opening = { location: 'City Gate', atmosphere: 'Ordinary city life below the hill' }
const reply = (background: string, extra: object = {}) => ({ role: 'char', scene: { background }, ...extra })

describe('scene setting derived from the branch', () => {
  it('follows a real change in reply tags, but a repeated tag is not a move', () => {
    const branch = [reply('city-gate'), { role: 'user' }, reply('guild-library'), reply('guild-library')]
    expect(sceneSettingFrom(branch, opening, label)).toEqual({ location: 'Guild Library', atmosphere: undefined, source: 'tag' })
  })

  it('a declared move to a place with no art survives later replies that keep tagging the nearest art', () => {
    const branch = [
      reply('city-gate'),
      reply('guild-library'),
      { role: 'user' },
      { role: 'char', gm: { setting: { location: 'Balcony terrace above the courtyard', atmosphere: 'Late sun, courtyard noise below' } } },
      reply('guild-library'),
      reply('guild-library'),
    ]
    expect(sceneSettingFrom(branch, opening, label)).toEqual({
      location: 'Balcony terrace above the courtyard',
      atmosphere: 'Late sun, courtyard noise below',
      source: 'gm',
    })
  })

  it('rewinding past the declared move restores the earlier place; a fork keeps what came before its cut', () => {
    const branch = [reply('city-gate'), reply('guild-library'), { role: 'char', gm: { setting: { location: 'Balcony terrace' } } }, reply('guild-library')]
    expect(sceneSettingFrom(branch.slice(0, 2), opening, label).location).toBe('Guild Library')
    expect(sceneSettingFrom(branch.slice(0, 3), opening, label).location).toBe('Balcony terrace')
  })

  it('a later genuine tag change still moves the scene on from a declared place', () => {
    const branch = [reply('guild-library'), { role: 'char', gm: { setting: { location: 'Balcony terrace' } } }, reply('guild-library'), reply('tavern')]
    expect(sceneSettingFrom(branch, opening, label).location).toBe('Tavern')
  })

  it("the player's Scene panel edit wins, and a new place drops the old atmosphere unless one is given", () => {
    const branch = [reply('city-gate'), { role: 'user', sceneSetting: { location: 'Rooftop garden' } }]
    expect(sceneSettingFrom(branch, opening, label)).toEqual({ location: 'Rooftop garden', atmosphere: undefined, source: 'player' })
    expect(sceneSettingFrom([], opening, label)).toEqual({ ...opening, source: 'chat' })
  })

  it('ignores failed replies and reads the active swipe', () => {
    const branch = [reply('city-gate'), reply('tavern', { failed: true }), { role: 'char', scene: { background: 'city-gate' }, swipeScenes: [{ background: 'city-gate' }, { background: 'guild-library' }], activeSwipe: 1 }]
    expect(sceneSettingFrom(branch, opening, label).location).toBe('Guild Library')
  })
})
