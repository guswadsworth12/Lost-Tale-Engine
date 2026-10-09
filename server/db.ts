import { migrateRecallReasons } from './recallReasonsMigration.ts'
import { migrateLinkWeights } from './linkWeightMigration.ts'
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// A git-ignored `.env` at the project root can keep user data outside the code checkout
// (`LOST_TALES_DATA_DIR=/path/to/data`). Variables already set in the environment win over it.
const envFile = path.resolve(__dirname, '..', '.env')
if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
const configuredDataDir = process.env.LOST_TALES_DATA_DIR || process.env.RP_DATA_DIR
export const dataDir = configuredDataDir ? path.resolve(configuredDataDir) : path.resolve(__dirname, '..', 'data')
export const avatarsDir = path.join(dataDir, 'avatars')
fs.mkdirSync(avatarsDir, { recursive: true })

// Node's built-in SQLite (stable API since v22.5, run behind --experimental-sqlite until it's
// unflagged) — replaces better-sqlite3, whose prebuilt native binary crashed the process outright
// (STATUS_ACCESS_VIOLATION) on some Windows/Node combinations, this one included. Being built
// into Node itself instead of a separately-downloaded .node binary avoids that whole class of bug.
export const db = new DatabaseSync(path.join(dataDir, 'rp.db'))
// Must be the very first statement on this connection, before anything else touches the file.
// `tsx watch` restarting this process on every source save can start the new process before
// Windows has fully released the previous one's lock on rp.db — without this, that shows up as an
// immediate, uncaught `Error: database is locked` crash on the very next pragma below, sometimes
// leaving the server down until something manually kills the stuck old process. This tells SQLite
// to retry quietly for up to 5s instead of failing the instant it meets a lock that's already about
// to clear on its own — the standard fix for exactly this transient-contention class of "locked".
db.exec('PRAGMA busy_timeout = 5000')
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

/**
 * Fold the write-ahead log back into rp.db so the main database file is self-contained and
 * current. WAL writes are already durable on disk (in rp.db-wal); this just means the primary
 * file alone is enough for a manual copy/backup. Called on clean server shutdown.
 */
export function checkpointDb(): void {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    worldId TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_characters_updatedAt ON characters(updatedAt);
  CREATE INDEX IF NOT EXISTS idx_characters_worldId ON characters(worldId);

  CREATE TABLE IF NOT EXISTS personas (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    characterId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chats_characterId ON chats(characterId);
  CREATE INDEX IF NOT EXISTS idx_chats_updatedAt ON chats(updatedAt);

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_chatId_createdAt ON messages(chatId, createdAt);

  CREATE TABLE IF NOT EXISTS world_info_books (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS presets (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS themes (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS instruct_templates (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  -- Plain assistant conversations. Deliberately not the chats table, which requires a characterId
  -- and carries the whole relationship track; an assistant thread has neither. Messages live in the
  -- row's own JSON rather than in the messages table, since a thread is read front to back and is
  -- never searched per-message or forked mid-way.
  CREATE TABLE IF NOT EXISTS assistant_threads (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS worlds (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS objectives (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    status TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_objectives_chatId_status ON objectives(chatId, status);

  CREATE TABLE IF NOT EXISTS relationship_events (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_relationship_events_chatId_createdAt ON relationship_events(chatId, createdAt);

  CREATE TABLE IF NOT EXISTS chat_facts (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_facts_chatId_createdAt ON chat_facts(chatId, createdAt);
  -- One per message, keyed by the message id: the scene's turn state and the world clock just before it (rewind, #57).
  CREATE TABLE IF NOT EXISTS chat_checkpoints (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chat_checkpoints_chatId ON chat_checkpoints(chatId);

  -- Stories made of scenes (\`server/stories.ts\`). The scenes themselves are chats carrying storyId.
  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  -- Per-character memories (\`server/memories.ts\`), each kept in the scene (chat) it happened in.
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    chatId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memories_chatId_createdAt ON memories(chatId, createdAt);

  CREATE TABLE IF NOT EXISTS memory_links (
    id TEXT PRIMARY KEY,
    memoryId TEXT NOT NULL,
    fromKind TEXT NOT NULL,
    fromId TEXT NOT NULL,
    relation TEXT NOT NULL,
    toKind TEXT NOT NULL,
    toId TEXT NOT NULL,
    validFrom INTEGER NOT NULL,
    validTo INTEGER,
    closedByMessageId TEXT,
    sourceMessageId TEXT,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memory_links_memoryId ON memory_links(memoryId);
  CREATE INDEX IF NOT EXISTS idx_memory_links_from ON memory_links(fromKind, fromId);
  CREATE INDEX IF NOT EXISTS idx_memory_links_to ON memory_links(toKind, toId);
  CREATE INDEX IF NOT EXISTS idx_memory_links_closedBy ON memory_links(closedByMessageId);

  -- Derived embeddings: rebuilt locally and deliberately omitted from backups.
  CREATE TABLE IF NOT EXISTS memory_vectors (
    memoryId TEXT NOT NULL,
    model TEXT NOT NULL,
    dims INTEGER NOT NULL,
    textHash TEXT NOT NULL,
    vector BLOB NOT NULL,
    updatedAt INTEGER NOT NULL,
    PRIMARY KEY (memoryId, model)
  );
  CREATE INDEX IF NOT EXISTS idx_memory_vectors_model ON memory_vectors(model);

  -- One recall per memory, speaker and reply swipe; indexed deletes keep rewind local.
  CREATE TABLE IF NOT EXISTS memory_recall_events (
    memoryId TEXT NOT NULL,
    characterId TEXT NOT NULL,
    chatId TEXT NOT NULL,
    messageId TEXT NOT NULL,
    swipe INTEGER NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (memoryId, characterId, messageId, swipe)
  );
  CREATE INDEX IF NOT EXISTS idx_recall_events_message ON memory_recall_events(messageId);
  CREATE INDEX IF NOT EXISTS idx_recall_events_chat ON memory_recall_events(chatId);
  CREATE INDEX IF NOT EXISTS idx_recall_events_speaker ON memory_recall_events(characterId, memoryId);

  -- Pictures of things that happened in a story (\`server/moments.ts\`), each from one scene.
  CREATE TABLE IF NOT EXISTS story_moments (
    id TEXT PRIMARY KEY,
    storyId TEXT NOT NULL,
    chatId TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_story_moments_storyId ON story_moments(storyId, createdAt);

  -- Accounts (\`server/auth.ts\`). Security state, never part of a backup or a restore.
  -- usernameKey / emailKey are the lowercased username and (optional) email, so both are unique
  -- regardless of case; the display spellings ride in the JSON blob.
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    usernameKey TEXT NOT NULL UNIQUE,
    emailKey TEXT,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_users_createdAt ON users(createdAt);

  -- A signed-in browser. id is the SHA-256 of the cookie's token, so the database never holds a
  -- usable token.
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    createdAt INTEGER NOT NULL,
    expiresAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
  CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON sessions(expiresAt);

  -- A user's encrypted credentials (\`server/vault.ts\`).
  CREATE TABLE IF NOT EXISTS user_secrets (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_user_secrets_userId ON user_secrets(userId);

  -- A user's preferences; id is the user's id.
  CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );

  -- An account that was removed: who it was, so what it left behind can be named (admin.ts). id is
  -- the old user id; createdAt is when it was removed.
  CREATE TABLE IF NOT EXISTS removed_users (
    id TEXT PRIMARY KEY,
    createdAt INTEGER NOT NULL,
    data TEXT NOT NULL
  );
`)

// Optional provenance column for installations that tested the earlier link schema.
if (!(db.prepare('PRAGMA table_info(memory_links)').all() as { name: string }[]).some((c) => c.name === 'sourceMessageId')) {
  db.exec('ALTER TABLE memory_links ADD COLUMN sourceMessageId TEXT')
  db.exec("UPDATE memory_links SET sourceMessageId = json_extract(data, '$.sourceMessageId')")
}
db.exec('CREATE INDEX IF NOT EXISTS idx_memory_links_sourceMessageId ON memory_links(sourceMessageId)')
migrateLinkWeights(db)
migrateRecallReasons(db)

// Accounts tables made before sign-in by email existed lack users.emailKey.
if (!(db.prepare('PRAGMA table_info(users)').all() as { name: string }[]).some((c) => c.name === 'emailKey')) {
  db.exec('ALTER TABLE users ADD COLUMN emailKey TEXT')
}
// Unique where set; SQLite lets any number of rows leave it NULL.
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_emailKey ON users(emailKey)')

type Row = Record<string, unknown>

// Every value that actually reaches a bind site here is a string, number, or null (ids,
// timestamps, a JSON blob) — this is a type-only cast, not a runtime coercion.
function bind(v: unknown): SQLInputValue {
  return v as SQLInputValue
}

interface ColumnSpec {
  name: string
}

/**
 * A table where a few fields get real (indexed/queryable) SQLite columns and
 * everything else rides along as one JSON blob column. This mirrors exactly what
 * the old IndexedDB store already did (whole objects, a couple of indexed keys) — a
 * full relational schema isn't warranted for a single-user local app, but plain
 * flat files can't be queried or sorted, which is why this sits in between.
 */
const SQL_CLAUSE_KEYWORDS = new Set(['AND', 'OR', 'NOT', 'IS', 'NULL', 'ASC', 'DESC', 'IN', 'LIKE'])

/**
 * Every current where/orderBy call site is a hardcoded literal, so this isn't exploitable
 * today — but nothing stops a future call site from building one out of a request field,
 * and column/clause identifiers can't be parameterized with `?` placeholders. Reject any
 * identifier-shaped token that isn't one of this table's own columns or a known-safe
 * SQL keyword, so that class of bug can't become a real SQL injection later.
 */
function assertSafeClause(kind: 'where' | 'orderBy', clause: string, columnNames: string[]): void {
  const allowedIdentifiers = new Set(['id', ...columnNames])
  const tokens = clause.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []
  for (const token of tokens) {
    if (allowedIdentifiers.has(token) || SQL_CLAUSE_KEYWORDS.has(token.toUpperCase())) continue
    throw new Error(`Unsafe SQL ${kind} clause: unrecognized identifier "${token}"`)
  }
}

function createStore(table: string, columns: ColumnSpec[]) {
  const columnNames = columns.map((c) => c.name)
  const insertColumns = ['id', ...columnNames, 'data']
  const insertStmt = db.prepare(
    `INSERT INTO ${table} (${insertColumns.join(', ')}) VALUES (${insertColumns.map(() => '?').join(', ')})`,
  )
  const updateStmt = db.prepare(
    `UPDATE ${table} SET ${[...columnNames, 'data'].map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
  )
  const deleteStmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`)
  const getStmt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`)

  function fromRow(row: Row): Row {
    const blob = JSON.parse(row.data as string) as Row
    const result: Row = { id: row.id, ...blob }
    for (const name of columnNames) result[name] = row[name]
    return result
  }

  function blobOf(obj: Row): string {
    const rest = { ...obj }
    delete rest.id
    for (const name of columnNames) delete rest[name]
    return JSON.stringify(rest)
  }

  return {
    list(opts?: { where?: string; params?: unknown[]; orderBy?: string }): Row[] {
      if (opts?.where) assertSafeClause('where', opts.where, columnNames)
      if (opts?.orderBy) assertSafeClause('orderBy', opts.orderBy, columnNames)
      let sql = `SELECT * FROM ${table}`
      if (opts?.where) sql += ` WHERE ${opts.where}`
      if (opts?.orderBy) sql += ` ORDER BY ${opts.orderBy}`
      const rows = db.prepare(sql).all(...(opts?.params ?? []).map(bind)) as Row[]
      return rows.map(fromRow)
    },
    get(id: string): Row | undefined {
      const row = getStmt.get(id) as Row | undefined
      return row ? fromRow(row) : undefined
    },
    insert(obj: Row): Row {
      insertStmt.run(bind(obj.id), ...columnNames.map((c) => bind(obj[c] ?? null)), blobOf(obj))
      return obj
    },
    update(id: string, patch: Row): Row | undefined {
      const existing = getStmt.get(id) as Row | undefined
      if (!existing) return undefined
      const merged: Row = { ...fromRow(existing), ...patch, id }
      updateStmt.run(...columnNames.map((c) => bind(merged[c] ?? null)), blobOf(merged), id)
      return merged
    },
    remove(id: string): void {
      deleteStmt.run(id)
    },
    /** Deletes every row in this table — used only by full-database restore. */
    clear(): void {
      db.exec(`DELETE FROM ${table}`)
    },
  }
}

export const characterStore = createStore('characters', [{ name: 'worldId' }, { name: 'createdAt' }, { name: 'updatedAt' }])
export const personaStore = createStore('personas', [{ name: 'createdAt' }])
export const chatStore = createStore('chats', [{ name: 'characterId' }, { name: 'createdAt' }, { name: 'updatedAt' }])
export const messageStore = createStore('messages', [{ name: 'chatId' }, { name: 'createdAt' }])
export const worldInfoBookStore = createStore('world_info_books', [{ name: 'createdAt' }])
export const presetStore = createStore('presets', [{ name: 'createdAt' }])
export const themeStore = createStore('themes', [{ name: 'createdAt' }])
export const instructTemplateStore = createStore('instruct_templates', [{ name: 'createdAt' }])
export const assistantThreadStore = createStore('assistant_threads', [{ name: 'createdAt' }, { name: 'updatedAt' }])
export const worldStore = createStore('worlds', [{ name: 'createdAt' }, { name: 'updatedAt' }])
export const objectiveStore = createStore('objectives', [
  { name: 'chatId' },
  { name: 'status' },
  { name: 'createdAt' },
  { name: 'updatedAt' },
])
export const relationshipEventStore = createStore('relationship_events', [{ name: 'chatId' }, { name: 'createdAt' }])
export const chatFactStore = createStore('chat_facts', [{ name: 'chatId' }, { name: 'createdAt' }])
/** The scene state saved with each message, for rewinding to it (`rewind.ts`). Keyed by the message id. */
export const chatCheckpointStore = createStore('chat_checkpoints', [{ name: 'chatId' }, { name: 'createdAt' }])
export const storyStore = createStore('stories', [{ name: 'createdAt' }, { name: 'updatedAt' }])
export const storyMomentStore = createStore('story_moments', [{ name: 'storyId' }, { name: 'chatId' }, { name: 'createdAt' }])
export const memoryLinkStore = createStore('memory_links', ['memoryId', 'fromKind', 'fromId', 'relation', 'toKind', 'toId', 'validFrom', 'validTo', 'closedByMessageId', 'sourceMessageId', 'weight', 'lastUsedAt', 'createdAt'].map((name) => ({ name })))
export const memoryStore = createStore('memories', [{ name: 'chatId' }, { name: 'createdAt' }])
// Accounts: security state, deliberately left out of BACKUP_STORES in app.ts.
export const userStore = createStore('users', [{ name: 'usernameKey' }, { name: 'emailKey' }, { name: 'createdAt' }])
export const sessionStore = createStore('sessions', [{ name: 'userId' }, { name: 'createdAt' }, { name: 'expiresAt' }])
export const userSecretStore = createStore('user_secrets', [{ name: 'userId' }, { name: 'name' }, { name: 'createdAt' }])
export const userSettingsStore = createStore('user_settings', [{ name: 'createdAt' }])
export const removedUserStore = createStore('removed_users', [{ name: 'createdAt' }])

export function newId(): string {
  return crypto.randomUUID()
}

export interface RecallEvent { memoryId: string; characterId: string; messageId: string; chatId: string; swipe: number; at: number; reasons?: string | null }

/** Indexed reply events; counts include only the selected swipe in the visible scene chain. */
export const memoryRecallStore = {
  list(): RecallEvent[] {
    return db.prepare('SELECT * FROM memory_recall_events').all() as unknown as RecallEvent[]
  },
  forChat(chatId: string): RecallEvent[] {
    return db.prepare('SELECT * FROM memory_recall_events WHERE chatId = ?').all(chatId) as unknown as RecallEvent[]
  },
  forReply(messageId: string, characterId: string, swipe: number): RecallEvent[] {
    return db.prepare('SELECT * FROM memory_recall_events WHERE messageId = ? AND characterId = ? AND swipe = ?').all(messageId, characterId, swipe) as unknown as RecallEvent[]
  },
  counts(characterId: string, chain: string[]) {
    if (!chain.length) return []
    return db.prepare(`SELECT e.memoryId, COUNT(*) AS count, MAX(e.at) AS lastAt
      FROM memory_recall_events e JOIN messages m ON m.id = e.messageId
      WHERE e.characterId = ? AND e.chatId IN (${chain.map(() => '?').join(', ')})
        AND e.swipe = COALESCE(json_extract(m.data, '$.activeSwipe'), 0)
      GROUP BY e.memoryId`).all(characterId, ...chain) as unknown as { memoryId: string; count: number; lastAt: number }[]
  },
  insert(row: Record<string, unknown>) {
    return db.prepare(`INSERT INTO memory_recall_events (memoryId, characterId, chatId, messageId, swipe, at, reasons)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(memoryId, characterId, messageId, swipe) DO NOTHING`)
      .run(bind(row.memoryId), bind(row.characterId), bind(row.chatId), bind(row.messageId), bind(row.swipe), bind(row.at), typeof row.reasons === 'string' ? row.reasons : row.reasons ? JSON.stringify(row.reasons) : null)
  },
  removeMemory(memoryId: string) { db.prepare('DELETE FROM memory_recall_events WHERE memoryId = ?').run(memoryId) },
  removeCharacter(characterId: string) { db.prepare('DELETE FROM memory_recall_events WHERE characterId = ?').run(characterId) },
  retract(messageId: string, swipe?: number) {
    if (swipe === undefined) db.prepare('DELETE FROM memory_recall_events WHERE messageId = ?').run(messageId)
    else db.prepare('DELETE FROM memory_recall_events WHERE messageId = ? AND swipe = ?').run(messageId, swipe)
  },
  removeSwipes(messageId: string, length: number) {
    db.prepare('DELETE FROM memory_recall_events WHERE messageId = ? AND swipe >= ?').run(messageId, length)
  },
  purgeChat(chatId: string) { db.prepare('DELETE FROM memory_recall_events WHERE chatId = ?').run(chatId) },
  clear() { db.exec('DELETE FROM memory_recall_events') },
}

/** Normalized float32 blobs stay on the server; only similarity scores leave it. */
export const memoryVectorStore = {
  get(memoryId: string, model: string) {
    const row = db.prepare('SELECT * FROM memory_vectors WHERE memoryId = ? AND model = ?').get(memoryId, model)
    if (!row) return undefined
    const bytes = row.vector as Uint8Array
    const vector = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    return { model: String(row.model), textHash: String(row.textHash), vector, dims: Number(row.dims) }
  },
  current(memoryId: string, model: string, textHash: string, dims?: number): boolean {
    return !!db.prepare('SELECT 1 FROM memory_vectors WHERE memoryId = ? AND model = ? AND textHash = ? AND (? IS NULL OR dims = ?)').get(memoryId, model, textHash, dims ?? null, dims ?? null)
  },
  insert(row: { memoryId: string; model: string; dims: number; textHash: string; vector: Float32Array }) {
    db.prepare(`INSERT INTO memory_vectors (memoryId, model, dims, textHash, vector, updatedAt) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(memoryId, model) DO UPDATE SET dims = excluded.dims, textHash = excluded.textHash, vector = excluded.vector, updatedAt = excluded.updatedAt`)
      .run(row.memoryId, row.model, row.dims, row.textHash, new Uint8Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength), Date.now())
  },
  remove(memoryId: string) { db.prepare('DELETE FROM memory_vectors WHERE memoryId = ?').run(memoryId) },
  copy(sourceId: string, targetId: string) {
    db.prepare(`INSERT INTO memory_vectors (memoryId, model, dims, textHash, vector, updatedAt)
      SELECT ?, model, dims, textHash, vector, updatedAt FROM memory_vectors WHERE memoryId = ?`).run(targetId, sourceId)
  },
  clear() { db.exec('DELETE FROM memory_vectors') },
}
