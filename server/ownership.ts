/**
 * Who can see and use a world, character, or world-info book. Kept free of any database import so
 * it can be tested alone; `access.ts` applies it to the routes.
 *
 * A row with no `visibility`, or `shared`, is everyone's, as everything was before ownership: that
 * is every row made before this, so nothing existing changes. A `private` row belongs to its
 * `ownerUserId` alone; to anyone else it doesn't exist. The site owner role is not an exception:
 * it doesn't read other people's private things either (server backups still hold everything).
 *
 * A chat has no visibility of its own. It follows what it uses: a story with a private world or a
 * private cast member is private to the same person.
 */

import type { AccountUser } from '../src/lib/accounts/contract.ts'
import type { Visibility } from '../src/lib/packs/contract.ts'

type Row = Record<string, unknown>
type User = Pick<AccountUser, 'id' | 'role'> | undefined

export function isPrivate(row: Row | undefined): boolean {
  return row?.visibility === 'private'
}

export function visibleTo(row: Row | undefined, user: User): boolean {
  if (!row) return false
  return !isPrivate(row) || (!!user && row.ownerUserId === user.id)
}

export interface Lookups {
  character: (id: string) => Row | undefined
  world: (id: string) => Row | undefined
}

/** Every character a chat uses: its lead, the card played, and the loaded cast. */
export function chatCharacterIds(chat: Row): string[] {
  const ids = [chat.characterId, chat.playerCharacterId, ...(Array.isArray(chat.participants) ? chat.participants : [])]
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && !!id))]
}

/** A character is visible when it is and the world it lives in is: a private world's cast is private with it. */
export function characterVisibleTo(character: Row | undefined, user: User, lookups: Lookups): boolean {
  if (!visibleTo(character, user)) return false
  const world = typeof character!.worldId === 'string' && character!.worldId ? lookups.world(character!.worldId) : undefined
  return !world || visibleTo(world, user)
}

/** A chat is visible when everything it uses is: each character, and each character's world. */
export function chatVisibleTo(chat: Row | undefined, user: User, lookups: Lookups): boolean {
  if (!chat) return false
  for (const id of chatCharacterIds(chat)) {
    const character = lookups.character(id)
    // A character deleted since is no one's; it can't hide the chat.
    if (character && !characterVisibleTo(character, user, lookups)) return false
  }
  return true
}

/**
 * Whether `user` may change who can see `row`. Its owner can. A row with no owner (made before
 * ownership) is everyone's, so only the site owner can take it private, and then owns it.
 */
export function canChangeVisibility(row: Row, user: User): boolean {
  if (!user) return false
  if (typeof row.ownerUserId === 'string' && row.ownerUserId) return row.ownerUserId === user.id
  return user.role === 'owner'
}

/**
 * The ownership fields a create or update may set, from a request body. `ownerUserId` is never
 * taken from the client. A create is owned by its maker and shared unless asked otherwise; an
 * update changes visibility only when `canChangeVisibility` allows it.
 */
export function ownershipPatch(body: Row, existing: Row | undefined, user: User): { patch: Row; refused?: string } {
  const asked = body.visibility
  const wanted: Visibility | undefined = asked === 'private' || asked === 'shared' ? asked : undefined
  if (!existing) {
    return { patch: { ...(user ? { ownerUserId: user.id } : {}), visibility: wanted ?? 'shared' } }
  }
  if (!wanted || wanted === (existing.visibility ?? 'shared')) return { patch: {} }
  if (!canChangeVisibility(existing, user)) return { patch: {}, refused: 'Only its owner can change who sees this.' }
  return { patch: { visibility: wanted, ...(existing.ownerUserId ? {} : { ownerUserId: user!.id }) } }
}
