import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { MessageBubble } from './MessageBubble'
import type { StoredMessage } from '@/lib/types'
const noop = () => {}
it('only shows the optional reasons button on enabled character replies, excluding the GM', () => {
  const message: StoredMessage = { id: 'synthetic-reply', chatId: 'synthetic-scene', role: 'char', name: 'Mara', text: 'The quay.', createdAt: 1 }
  const render = (showMemoryReasons: boolean, patch: Partial<StoredMessage> = {}) => renderToStaticMarkup(createElement(MessageBubble, { message: { ...message, ...patch }, showMemoryReasons, onEdit: noop, onDelete: noop, onRewind: noop, onRegenerate: noop, onSteer: noop, onSwipe: noop, onFork: noop, onTogglePin: noop }))
  expect(render(false)).not.toContain('Why these memories?')
  expect(render(true)).toContain('Why these memories?')
  expect(render(true, { gm: { mode: 'guided', ruleset: 'synthetic', narration: '', pacing: 'linger', speakerIds: [], proposals: [], scenery: '' } })).not.toContain('Why these memories?')
  expect(render(true, { role: 'user' })).not.toContain('Why these memories?')
})
