import type { AccountUser } from '@/lib/accounts/contract'
import type { ConflictResolution, PackConflict, PackSelection, PackSummaryLine, Visibility } from './contract'
import type { MediaKind } from './fields'

/**
 * What the pack dialogs show and decide, without any React: the export checklist's rows, byte
 * sizes, which files an upload sends, and who may change a row's visibility.
 */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

type Flag = 'lore' | 'worldContent' | 'cast' | 'promptOverrides' | 'gmNotes' | 'canonFacts' | 'npcSheets' | 'privateMemory' | 'playerCards'

export interface ExportRow {
  /** A top-level option, or `media:<kind>`. */
  key: Flag | `media:${MediaKind}`
  label: string
  hint?: string
  /** Off by default: may hold spoilers or someone's own play. */
  optional?: boolean
}

export const EXPORT_ROWS: ExportRow[] = [
  { key: 'lore', label: 'Lore', hint: "The world's lorebook and world-info books bound to it or its cast." },
  { key: 'worldContent', label: 'Prompts, scenarios, triggers, gifts, items, and stage layouts' },
  { key: 'cast', label: 'Cast', hint: 'Non-player characters, as templates.' },
  { key: 'media:portraits', label: 'Portraits' },
  { key: 'media:sprites', label: 'Sprites and outfits' },
  { key: 'media:backgrounds', label: 'Backgrounds, day and night' },
  { key: 'media:music', label: 'Music' },
  { key: 'media:gallery', label: 'Gallery art' },
  { key: 'media:models', label: 'VRM models', hint: 'Large files.', optional: true },
  { key: 'promptOverrides', label: 'Prompt tuning', hint: "This world's own guidance for the GM, scribe, recaps and journals." },
  { key: 'gmNotes', label: 'GM notes', hint: 'May hold spoilers.', optional: true },
  { key: 'canonFacts', label: 'Canon facts from play', hint: 'Facts confirmed in your own stories.', optional: true },
  { key: 'npcSheets', label: 'Stat sheets of the cast', optional: true },
  { key: 'privateMemory', label: 'Private memory of the cast', optional: true },
  { key: 'playerCards', label: 'Player cards', hint: 'Cards made to be played by a person.', optional: true },
]

export function rowChecked(selection: PackSelection, key: ExportRow['key']): boolean {
  return key.startsWith('media:') ? selection.media[key.slice(6) as MediaKind] : selection[key as Flag]
}

export function toggleRow(selection: PackSelection, key: ExportRow['key'], on: boolean): PackSelection {
  if (key.startsWith('media:')) return { ...selection, media: { ...selection.media, [key.slice(6)]: on } }
  return { ...selection, [key]: on }
}

/** The preview's line for a row, for its count and size. */
export function lineFor(included: readonly PackSummaryLine[], key: ExportRow['key']): PackSummaryLine | undefined {
  if (key.startsWith('media:')) return included.find((line) => line.media === key.slice(6))
  if (key === 'cast') return included.find((line) => line.label === 'Cast')
  if (key === 'lore') return included.find((line) => line.label === 'World-info books')
  return undefined
}

/**
 * The files an upload sends: a zip as itself, or each file of a picked folder under its path in
 * the folder (`webkitRelativePath`). A lone file that isn't a zip isn't a pack.
 */
export function uploadEntries(files: readonly File[]): { path: string; file: File }[] {
  if (files.length === 1 && /\.zip$/i.test(files[0].name) && !(files[0] as File & { webkitRelativePath?: string }).webkitRelativePath) {
    return [{ path: files[0].name.replace(/[/\\]/g, '_'), file: files[0] }]
  }
  return files
    .map((file) => ({ path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name, file }))
    .filter((entry) => entry.path.includes('/'))
}

export function defaultResolutions(conflicts: readonly PackConflict[]): Record<string, ConflictResolution> {
  return Object.fromEntries(conflicts.map((c) => [c.key, 'copy' as const]))
}

export function replacesAnything(resolutions: Record<string, ConflictResolution>): boolean {
  return Object.values(resolutions).includes('replace')
}

/** Mirrors the server's rule (`server/ownership.ts`): the owner, or for a row with no owner, the site owner. */
export function mayChangeVisibility(row: { ownerUserId?: string } | undefined, user: Pick<AccountUser, 'id' | 'role'> | null | undefined): boolean {
  if (!row || !user) return false
  return row.ownerUserId ? row.ownerUserId === user.id : user.role === 'owner'
}

export function visibilityLabel(visibility: Visibility | undefined): string {
  // Private unless shared on purpose (server/ownership.ts).
  return visibility === 'shared' ? 'Everyone signed in' : 'Only me'
}
