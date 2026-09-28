import fs from 'node:fs'
import path from 'node:path'

/**
 * One-time fold of the old `personas` table into character cards (cards and personas merged).
 *
 * - A persona linked to a character becomes that character. Its own public blurb, if any, moves to
 *   the card's `playerDescription` unless the card already has one.
 * - A standalone persona whose name matches exactly one existing card (ignoring case and spacing)
 *   is the same person played from both sides, so it joins that card the same way.
 * - Any other standalone persona becomes a new "you only" card (`playerOnly`) with its name,
 *   description, and portrait.
 * - Each story's `personaId` is resolved to `playerCharacterId`. `personaId` itself is left in place
 *   so the result can be checked against the old data.
 *
 * Idempotent: a persona row carries `migratedToCharacterId` once folded and is skipped after that,
 * and a story that already has `playerCharacterId` is never touched. The persona rows themselves
 * are kept (read-only from here on) so old ids can still be mapped.
 */

type Row = Record<string, unknown>

export interface MergePlan {
  newCharacters: Row[]
  characterPatches: { id: string; patch: Row }[]
  personaPatches: { id: string; patch: Row }[]
  chatPatches: { id: string; patch: Row }[]
  /** New character id → the persona avatar file to copy, relative to the avatars dir. */
  avatarCopies: { characterId: string; from: string }[]
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function blankCard(name: string, description: string): Row {
  return {
    name,
    description,
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    tags: [],
    creator: '',
    character_version: '',
    extensions: {},
  }
}

/** `/avatars/personas/<id>.<ext>?t=…` → `personas/<id>.<ext>`, or undefined for anything else. */
function personaAvatarFile(url: unknown): string | undefined {
  const m = /^\/avatars\/(personas\/[0-9a-f-]+\.[a-z0-9]+)(?:\?.*)?$/i.exec(str(url))
  return m?.[1]
}

export function planPersonaMerge(
  personas: Row[],
  characters: Row[],
  chats: Row[],
  newId: () => string,
  now: number,
): MergePlan {
  const plan: MergePlan = { newCharacters: [], characterPatches: [], personaPatches: [], chatPatches: [], avatarCopies: [] }
  const characterById = new Map(characters.map((c) => [str(c.id), c]))
  const nameKey = (v: unknown) => str(v).trim().replace(/\s+/g, ' ').toLowerCase()
  const byName = new Map<string, Row[]>()
  for (const c of characters) {
    const key = nameKey((c.card as Row | undefined)?.name)
    if (key) byName.set(key, [...(byName.get(key) ?? []), c])
  }
  const target = new Map<string, string>()

  for (const persona of personas) {
    const personaId = str(persona.id)
    const done = str(persona.migratedToCharacterId)
    if (done && characterById.has(done)) {
      target.set(personaId, done)
      continue
    }
    const sameName = byName.get(nameKey(persona.name))
    const linked = characterById.get(str(persona.characterId)) ?? (sameName?.length === 1 ? sameName[0] : undefined)
    if (linked) {
      const id = str(linked.id)
      target.set(personaId, id)
      const own = str(persona.description).trim()
      if (own && !str(linked.playerDescription).trim() && own !== str((linked.card as Row | undefined)?.description).trim()) {
        plan.characterPatches.push({ id, patch: { playerDescription: own } })
      }
    } else {
      const id = newId()
      target.set(personaId, id)
      const avatar = personaAvatarFile(persona.avatarDataUrl)
      if (avatar) plan.avatarCopies.push({ characterId: id, from: avatar })
      plan.newCharacters.push({
        id,
        card: blankCard(str(persona.name) || 'You', str(persona.description)),
        playerOnly: true,
        gmEligible: false,
        // Filled in once the avatar is copied; a persona without one simply has none.
        avatarDataUrl: undefined,
        createdAt: typeof persona.createdAt === 'number' ? persona.createdAt : now,
        updatedAt: now,
      })
    }
    plan.personaPatches.push({ id: personaId, patch: { migratedToCharacterId: target.get(personaId) } })
  }

  for (const chat of chats) {
    if (str(chat.playerCharacterId)) continue
    const mapped = target.get(str(chat.personaId))
    if (mapped) plan.chatPatches.push({ id: str(chat.id), patch: { playerCharacterId: mapped } })
  }
  return plan
}

export function isEmptyPlan(plan: MergePlan): boolean {
  return !plan.newCharacters.length && !plan.characterPatches.length && !plan.personaPatches.length && !plan.chatPatches.length
}

/** Held for the whole run so two server processes on one data dir can't both migrate. */
function acquireLock(file: string): boolean {
  try {
    fs.writeFileSync(file, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    // A lock left by a crashed run is stale after a minute; take it over.
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > 60_000) {
        fs.writeFileSync(file, String(process.pid))
        return true
      }
    } catch {
      /* raced with its removal; treat as held */
    }
    return false
  }
}

interface Store {
  list(): Row[]
  insert(obj: Row): Row
  update(id: string, patch: Row): Row | undefined
}

/** Runs the plan against the live stores, after a consistent backup of the whole database. */
export function mergePersonasIntoCards(opts: {
  personaStore: Store
  characterStore: Store
  chatStore: Store
  avatarsDir: string
  dataDir: string
  backup: (file: string) => void
  /** Runs the writes as one unit, so a crash can't leave a half-merged database. */
  transaction: (fn: () => void) => void
  newId: () => string
  log?: (msg: string) => void
}): MergePlan | undefined {
  const lock = path.join(opts.dataDir, '.card-merge.lock')
  if (!acquireLock(lock)) {
    opts.log?.('[rp-server] another process is merging personas into cards; skipping here')
    return undefined
  }
  try {
    return runMerge(opts)
  } finally {
    fs.rmSync(lock, { force: true })
  }
}

function runMerge(opts: Parameters<typeof mergePersonasIntoCards>[0]): MergePlan {
  const now = Date.now()
  // Planned only once the lock is held, so it always sees the other process's finished work.
  const plan = planPersonaMerge(opts.personaStore.list(), opts.characterStore.list(), opts.chatStore.list(), opts.newId, now)
  if (isEmptyPlan(plan)) return plan

  const backupDir = path.join(opts.dataDir, 'backups')
  fs.mkdirSync(backupDir, { recursive: true })
  const backupFile = path.join(backupDir, `pre-card-merge-${now}.db`)
  opts.backup(backupFile)

  // Portraits first (files, outside the transaction); a copy nothing ends up referencing is harmless.
  for (const character of plan.newCharacters) {
    const copy = plan.avatarCopies.find((c) => c.characterId === character.id)
    const source = copy && path.join(opts.avatarsDir, copy.from)
    if (source && fs.existsSync(source)) {
      const dir = path.join(opts.avatarsDir, 'characters', String(character.id))
      fs.mkdirSync(dir, { recursive: true })
      const file = `avatar${path.extname(source)}`
      fs.copyFileSync(source, path.join(dir, file))
      character.avatarDataUrl = `/avatars/characters/${character.id}/${file}?t=${now}`
    }
  }
  opts.transaction(() => {
    for (const character of plan.newCharacters) opts.characterStore.insert(character)
    for (const { id, patch } of plan.characterPatches) opts.characterStore.update(id, { ...patch, updatedAt: now })
    for (const { id, patch } of plan.chatPatches) opts.chatStore.update(id, patch)
    for (const { id, patch } of plan.personaPatches) opts.personaStore.update(id, patch)
  })

  opts.log?.(
    `[rp-server] merged personas into cards: ${plan.newCharacters.length} new player card(s), ` +
      `${plan.personaPatches.length - plan.newCharacters.length} linked, ${plan.chatPatches.length} stor${plan.chatPatches.length === 1 ? 'y' : 'ies'} updated. ` +
      `Backup: ${backupFile}`,
  )
  return plan
}
