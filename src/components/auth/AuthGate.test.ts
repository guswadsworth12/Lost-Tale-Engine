import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/accounts/secrets', () => ({ migrateLocalSecrets: async () => {} }))

import { AuthGate, GateView, gateScreen, type GateScreen } from './AuthGate'

const base = { status: 'signedOut' as const, needsSetup: false, setupAllowedHere: false, error: null, ready: false }

describe('gateScreen', () => {
  it('waits on the first status check, or offers a retry if it failed', () => {
    expect(gateScreen({ ...base, status: 'unknown' })).toBe('loading')
    expect(gateScreen({ ...base, status: 'unknown', error: 'down' })).toBe('error')
  })

  it('routes a fresh install to setup only on the host machine', () => {
    expect(gateScreen({ ...base, needsSetup: true, setupAllowedHere: true })).toBe('setup')
    expect(gateScreen({ ...base, needsSetup: true, setupAllowedHere: false })).toBe('setupElsewhere')
  })

  it('asks a signed-out visitor to sign in', () => {
    expect(gateScreen(base)).toBe('login')
  })

  it('asks a setup-code sign-in to choose a password before anything else', () => {
    expect(gateScreen({ ...base, status: 'signedIn', mustSetPassword: true })).toBe('choosePassword')
    expect(gateScreen({ ...base, status: 'signedIn', mustSetPassword: true, ready: true })).toBe('choosePassword')
  })

  it('shows the app only once the signed-in user is ready', () => {
    expect(gateScreen({ ...base, status: 'signedIn' })).toBe('loading')
    expect(gateScreen({ ...base, status: 'signedIn', ready: true })).toBe('app')
  })
})

describe('GateView', () => {
  const render = (screen: GateScreen, error: string | null = null) =>
    renderToStaticMarkup(createElement(GateView, { screen, error, onRetry: () => {}, children: createElement('main', null, 'APP CONTENT') }))

  it('renders nothing of the app while loading', () => {
    expect(render('loading')).not.toContain('APP CONTENT')
  })

  it('renders the sign-in form with password-manager hints', () => {
    const html = render('login')
    expect(html).toContain('Sign in')
    expect(html).toContain('Username or email')
    expect(html).toContain('Password or setup code')
    expect(html).toContain('First time? Use the setup code you were given.')
    expect(html).toMatch(/autocomplete="username"/i)
    expect(html).toMatch(/autocomplete="current-password"/i)
    expect(html).not.toContain('APP CONTENT')
  })

  it('renders owner setup', () => {
    const html = render('setup')
    expect(html).toContain('Create the owner account')
    expect(html).toMatch(/autocomplete="new-password"/i)
  })

  it('renders the choose-password screen', () => {
    const html = renderToStaticMarkup(createElement(GateView, {
      screen: 'choosePassword', error: null, onRetry: () => {}, username: 'someone', children: createElement('main', null, 'APP CONTENT'),
    }))
    expect(html).toContain('Choose your password')
    expect(html.match(/autocomplete="new-password"/gi)?.length).toBe(2)
    expect(html).toContain('value="someone"')
    expect(html).not.toContain('APP CONTENT')
  })

  it('points elsewhere when setup is not allowed from here', () => {
    const html = render('setupElsewhere')
    expect(html).toContain('npm run create-user')
    expect(html).not.toContain('Create the owner account')
  })

  it('shows the status error with a retry', () => {
    expect(render('error', 'offline')).toContain('offline')
  })

  it('renders the app when ready', () => {
    expect(render('app')).toContain('APP CONTENT')
  })
})

describe('AuthGate', () => {
  it('renders nothing of the app before the status is known', () => {
    const html = renderToStaticMarkup(createElement(AuthGate, null, createElement('main', null, 'APP CONTENT')))
    expect(html).not.toContain('APP CONTENT')
  })
})
