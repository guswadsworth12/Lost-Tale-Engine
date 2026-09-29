import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/accounts/secrets', () => ({ migrateLocalSecrets: async () => {} }))

import { SetupCodeNotice } from './AccountSettings'

describe('SetupCodeNotice', () => {
  it('shows the code once, with its expiry and a warning', () => {
    const html = renderToStaticMarkup(createElement(SetupCodeNotice, {
      issued: {
        user: { id: 'u1', username: 'someone', email: 'someone@example.test', role: 'member', createdAt: 0 },
        code: 'ABCD-EFGH-JKLM',
        expiresAt: Date.now() + 3 * 24 * 3_600_000,
      },
      onDone: () => {},
    }))
    expect(html).toContain('ABCD-EFGH-JKLM')
    expect(html).toContain('someone')
    expect(html).toMatch(/Expires in 3 days/)
    expect(html).toMatch(/won(&#x27;|')t be shown again/)
  })
})
