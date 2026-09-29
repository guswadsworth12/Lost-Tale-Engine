import { describe, expect, it } from 'vitest'
import type { CharacterMemory } from '@/lib/types'
import { joinNames, memoriesByMessage, rememberLine, rememberers } from './memoryMarker'

const mem = (over: Partial<CharacterMemory>): CharacterMemory => ({
  id: 'm',
  chatId: 'c1',
  text: 'Something happened.',
  kind: 'event',
  witnesses: ['ash'],
  knownBy: ['ash'],
  importance: 0.5,
  active: true,
  origin: 'scribe',
  createdAt: 0,
  ...over,
})

const names: Record<string, string> = { ash: 'Ash', bea: 'Bea', cole: 'Cole' }
const nameOf = (id: string) => names[id]

describe('joinNames', () => {
  it('reads naturally for one, two, and more', () => {
    expect(joinNames([])).toBe('')
    expect(joinNames(['Ash'])).toBe('Ash')
    expect(joinNames(['Ash', 'Bea'])).toBe('Ash and Bea')
    expect(joinNames(['Ash', 'Bea', 'Cole'])).toBe('Ash, Bea and Cole')
  })
})

describe('rememberLine', () => {
  it('says who will remember', () => {
    expect(rememberLine(['Ash'])).toBe('Ash will remember this')
    expect(rememberLine(['Ash', 'Bea', 'Cole'])).toBe('Ash, Bea and Cole will remember this')
    expect(rememberLine([])).toBe('Someone will remember this')
  })
})

describe('memoriesByMessage', () => {
  it('keeps active, non-journal memories that came from a message', () => {
    const map = memoriesByMessage([
      mem({ id: 'a', sourceMessageId: 'msg1' }),
      mem({ id: 'b', sourceMessageId: 'msg1' }),
      mem({ id: 'c', sourceMessageId: 'msg2', active: false }),
      mem({ id: 'd', sourceMessageId: 'msg2', kind: 'journal' }),
      mem({ id: 'e' }),
    ])
    expect([...map.keys()]).toEqual(['msg1'])
    expect(map.get('msg1')!.map((m) => m.id)).toEqual(['a', 'b'])
  })
})

describe('rememberers', () => {
  it('unions everyone who knows any of them, in order, unknown ids once as "Someone" last', () => {
    const list = [mem({ knownBy: ['bea', 'ghost'] }), mem({ knownBy: ['ash', 'bea', 'other'] })]
    expect(rememberers(list, nameOf)).toEqual(['Bea', 'Ash', 'Someone'])
    expect(rememberLine(rememberers(list, nameOf))).toBe('Bea, Ash and Someone will remember this')
  })
})

describe('MessageBubble memory line', () => {
  it('shows who will remember a message, collapsed until clicked', async () => {
    const { createElement } = await import('react')
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { MessageBubble } = await import('./MessageBubble')
    const noop = () => {}
    const props = {
      message: { id: 'msg1', chatId: 'c1', role: 'char', name: 'Ash', text: 'Hello.', createdAt: 0 } as never,
      onEdit: noop, onDelete: noop, onRewind: noop, onRegenerate: noop, onSteer: noop, onSwipe: noop, onFork: noop, onTogglePin: noop,
    }
    expect(renderToStaticMarkup(createElement(MessageBubble, props))).not.toContain('will remember this')
    const html = renderToStaticMarkup(createElement(MessageBubble, { ...props, memoryNote: { line: 'Ash and Bea will remember this', texts: ['Ash lied to Bea.'] } }))
    expect(html).toContain('Ash and Bea will remember this')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('Ash lied to Bea.')
  })
})
