/**
 * Who can see and use a world, character, world-info book, story, or personal record (a Writer's
 * Room thread, a preset). Kept free of any database import so it can be tested alone; `access.ts`
 * applies it to the routes.
 *
 * Private unless shared on purpose. A row is visible to its owner, and to anyone else only when its
 * `visibility` is `shared`, which only its owner can choose. A row with no `ownerUserId` was made
 * before accounts owned things, on the site owner's own install, so it belongs to the site owner.
 * The site owner role is otherwise no exception: it doesn't read other people's things either
 * (server backups still hold everything).
 *
 * A chat (a story's scene) is never shared: it belongs to whoever started it.
 */

import type { AccountUser } from '../src/lib/accounts/contract.ts'
import type { Visibility } from '../src/lib/packs/contract.ts'

type Row = Record<string, unknown>
type User = Pick<AccountUser, 'id' | 'role'> | undefined

/** Whose a row is: its owner, or the site owner's for a row made before accounts owned things. */
export function ownerOf(row: Row, siteOwnerId: string | undefined): string | undefined {
  return typeof row.ownerUserId === 'string' && row.ownerUserId ? row.ownerUserId : siteOwnerId
}

/** Shared on purpose. Anything else (`private`, or nothing set) is its owner's alone. */
export function isShared(row: Row | undefined): boolean {
  return row?.visibility === 'shared'
}

export function ownsRow(row: Row | undefined, user: User, siteOwnerId: string | undefined): boolean {
  return !!row && !!user && ownerOf(row, siteOwnerId) === user.id
}

export function visibleTo(row: Row | undefined, user: User, siteOwnerId: string | undefined): boolean {
  if (!row) return false
  return isShared(row) || ownsRow(row, user, siteOwnerId)
}

export interface Lookups {
  character: (id: string) => Row | undefined
  world: (id: string) => Row | undefined
  /** The account that owns the install: rows from before accounts are theirs. */
  siteOwnerId: () => string | undefined
}

/** Every character a chat uses: its lead, the card played, and the loaded cast. */
export function chatCharacterIds(chat: Row): string[] {
  const ids = [chat.characterId, chat.playerCharacterId, ...(Array.isArray(chat.participants) ? chat.participants : [])]
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && !!id))]
}

/** A character is visible when it is and the world it lives in is: a private world's cast is private with it. */
export function characterVisibleTo(character: Row | undefined, user: User, lookups: Lookups): boolean {
  const siteOwnerId = lookups.siteOwnerId()
  if (!visibleTo(character, user, siteOwnerId)) return false
  const world = typeof character!.worldId === 'string' && character!.worldId ? lookups.world(character!.worldId) : undefined
  return !world || visibleTo(world, user, siteOwnerId)
}

/** A chat is its starter's alone, whatever characters and world it uses. */
export function chatVisibleTo(chat: Row | undefined, user: User, lookups: Lookups): boolean {
  return ownsRow(chat, user, lookups.siteOwnerId())
}

/** Only a row's owner may change who sees it. */
export function canChangeVisibility(row: Row, user: User, siteOwnerId: string | undefined): boolean {
  return ownsRow(row, user, siteOwnerId)
}

/**
 * The ownership fields a create or update may set, from a request body. `ownerUserId` is never
 * taken from the client. A create is owned by its maker and private unless sharing is asked for;
 * an update changes visibility only when `canChangeVisibility` allows it.
 */
export function ownershipPatch(body: Row, existing: Row | undefined, user: User, siteOwnerId: string | undefined): { patch: Row; refused?: string } {
  const asked = body.visibility
  const wanted: Visibility | undefined = asked === 'private' || asked === 'shared' ? asked : undefined
  if (!existing) {
    return { patch: { ...(user ? { ownerUserId: user.id } : {}), visibility: wanted ?? 'private' } }
  }
  if (!wanted || wanted === (isShared(existing) ? 'shared' : 'private')) return { patch: {} }
  if (!canChangeVisibility(existing, user, siteOwnerId)) return { patch: {}, refused: 'Only its owner can change who sees this.' }
  return { patch: { visibility: wanted, ownerUserId: ownerOf(existing, siteOwnerId) } }
}
