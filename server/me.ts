import express from 'express'
import { currentUser } from './auth.ts'
import { userSettingsStore } from './db.ts'
import { SecretInputError, deleteSecret, secretStatuses, setSecret } from './vault.ts'
import { SECRET_SETTING_KEYS, isSecretName, type AccountUser } from '../src/lib/accounts/contract.ts'

/**
 * The signed-in user's own things: their credentials (write-only — the response only ever says
 * whether one is saved) and their preferences. Mounted after the session gate.
 */

export const MAX_SETTINGS_BYTES = 1_000_000
const MAX_SETTINGS_DEPTH = 32

export const meRouter = express.Router()
const json = express.json({ limit: '2mb' })

function requireCurrentUser(req: express.Request, res: express.Response): AccountUser | undefined {
  const user = currentUser(req)
  if (!user) res.status(401).json({ error: 'Sign in first' })
  return user
}

/**
 * A copy of the settings without any credential field, at any depth. Plaintext secrets must never
 * land in the settings table, even when a client sends them.
 */
export function stripSecretSettings(value: unknown, depth = 0): unknown {
  if (depth > MAX_SETTINGS_DEPTH) throw new SecretInputError('Settings are nested too deeply')
  if (Array.isArray(value)) return value.map((item) => stripSecretSettings(item, depth + 1))
  if (!value || typeof value !== 'object') return value
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if ((SECRET_SETTING_KEYS as readonly string[]).includes(key)) continue
    result[key] = stripSecretSettings(child, depth + 1)
  }
  return result
}

meRouter.get('/api/me/secrets', (req, res) => {
  const user = requireCurrentUser(req, res)
  if (!user) return
  res.setHeader('Cache-Control', 'no-store')
  res.json(secretStatuses(user.id))
})

meRouter.put('/api/me/secrets/:name', json, (req, res) => {
  const user = requireCurrentUser(req, res)
  if (!user) return
  const { name } = req.params
  if (!isSecretName(name)) { res.status(404).json({ error: 'Unknown secret' }); return }
  const value = (req.body as { value?: unknown } | undefined)?.value
  if (typeof value !== 'string') { res.status(400).json({ error: 'Send {"value": "..."}' }); return }
  try {
    setSecret(user.id, name, value)
  } catch (error) {
    if (error instanceof SecretInputError) { res.status(400).json({ error: error.message }); return }
    console.error(`[vault] Could not save ${name}`)
    res.status(500).json({ error: 'Could not save it. Try again.' })
    return
  }
  res.status(204).end()
})

meRouter.delete('/api/me/secrets/:name', (req, res) => {
  const user = requireCurrentUser(req, res)
  if (!user) return
  const { name } = req.params
  if (!isSecretName(name)) { res.status(404).json({ error: 'Unknown secret' }); return }
  deleteSecret(user.id, name)
  res.status(204).end()
})

meRouter.get('/api/me/settings', (req, res) => {
  const user = requireCurrentUser(req, res)
  if (!user) return
  res.setHeader('Cache-Control', 'no-store')
  const row = userSettingsStore.get(user.id)
  if (!row) { res.json({ settings: null }); return }
  // Stripped again on the way out, in case a row predates the write-side filter.
  res.json({ settings: stripSecretSettings(row.settings ?? null), updatedAt: row.updatedAt })
})

meRouter.put('/api/me/settings', json, (req, res) => {
  const user = requireCurrentUser(req, res)
  if (!user) return
  const raw = (req.body as { settings?: unknown } | undefined)?.settings
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    res.status(400).json({ error: 'Send {"settings": {...}}' }); return
  }
  let settings: unknown
  try { settings = stripSecretSettings(raw) } catch (error) {
    res.status(400).json({ error: (error as Error).message }); return
  }
  if (Buffer.byteLength(JSON.stringify(settings), 'utf8') > MAX_SETTINGS_BYTES) {
    res.status(413).json({ error: 'Settings are too large' }); return
  }
  const updatedAt = Date.now()
  if (userSettingsStore.get(user.id)) userSettingsStore.update(user.id, { settings, updatedAt })
  else userSettingsStore.insert({ id: user.id, createdAt: updatedAt, settings, updatedAt })
  res.json({ updatedAt })
})
