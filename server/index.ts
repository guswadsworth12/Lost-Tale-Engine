import fs from 'node:fs'
import path from 'node:path'
import { app, purgeExpiredTrash } from './app.ts'
import {
  assistantThreadStore, avatarsDir, characterStore, chatStore, checkpointDb, dataDir, db, instructTemplateStore, newId, personaStore,
  presetStore, storyStore, themeStore, worldInfoBookStore, worldStore,
} from './db.ts'
import { siteOwnerId } from './access.ts'
import { mergePersonasIntoCards } from './migrations/mergePersonas.ts'
import { PRIVATE_BY_DEFAULT_MARKER, makePrivateByDefault, type OwnedTable } from './migrations/privateByDefault.ts'
import { SHARED_SEED_IDS, runSeedIfNeeded } from './seed.ts'

runSeedIfNeeded()
// Runs after seeding so a fresh install's starter persona becomes a card straight away. A no-op
// once everything is folded; the first real run backs the database up before writing anything.
mergePersonasIntoCards({
  personaStore,
  characterStore,
  chatStore,
  avatarsDir,
  dataDir,
  backup: (file) => db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`),
  transaction: (fn) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      fn()
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  },
  newId,
  log: (msg) => console.log(msg),
})
// Everything private to its owner unless shared on purpose (ownership.ts): once per install, after a backup.
const ownedStores: Record<OwnedTable, { list: () => Record<string, unknown>[]; update: (id: string, patch: Record<string, unknown>) => unknown }> = {
  worlds: worldStore, characters: characterStore, world_info_books: worldInfoBookStore, personas: personaStore,
  chats: chatStore, stories: storyStore, presets: presetStore, themes: themeStore, instruct_templates: instructTemplateStore, assistant_threads: assistantThreadStore,
}
const privateMarker = path.join(dataDir, 'migrations', PRIVATE_BY_DEFAULT_MARKER)
makePrivateByDefault({
  list: (table) => ownedStores[table].list(),
  update: (table, id, patch) => { ownedStores[table].update(id, patch) },
  siteOwnerId,
  sharedSeedIds: SHARED_SEED_IDS,
  done: () => fs.existsSync(privateMarker),
  markDone: () => {
    fs.mkdirSync(path.dirname(privateMarker), { recursive: true })
    fs.writeFileSync(privateMarker, `${new Date().toISOString()}\n`)
  },
  backup: () => {
    fs.mkdirSync(path.join(dataDir, 'backups'), { recursive: true })
    const file = path.join(dataDir, 'backups', `pre-private-by-default-${Date.now()}.db`)
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  },
  transaction: (fn) => {
    db.exec('BEGIN IMMEDIATE')
    try {
      fn()
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  },
  log: (msg) => console.log(msg),
})
purgeExpiredTrash()

const port = Number(process.env.API_PORT) || 3001

// Loopback-only by default. The API sits behind a sign-in (auth.ts), but first-time setup is
// allowed only from this machine and the data is still best kept off the open network. A container
// can't publish a port it can't reach, so Docker sets API_HOST=0.0.0.0 and leans on Docker's own
// port mapping (and whatever firewall / reverse-proxy auth you put in front) to control access.
const host = process.env.API_HOST || '127.0.0.1'

app.listen(port, host, () => {
  console.log(`[rp-server] listening on http://${host}:${port} — data stored in ${dataDir}`)
})

// On a clean exit (Ctrl+C, or the dev watcher restarting the process), fold the write-ahead log
// back into rp.db so the main file is complete on its own. WAL writes are already durable on
// disk either way; this just spares anyone who copies rp.db without its -wal sidecar. `db.exec`
// is synchronous and a signal handler runs between ticks, so nothing can be mid-write here.
let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  try {
    checkpointDb()
  } catch (e) {
    console.error('[rp-server] checkpoint on shutdown failed:', e)
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
