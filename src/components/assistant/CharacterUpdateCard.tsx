import { useId, useState } from 'react'
import { ArrowRight, Check, Minus, Plus, UserCog } from 'lucide-react'
import type { CharacterUpdateDraft } from '@/lib/assistant/thread'
import { Button } from '@/components/ui/Button'
import { Spinner } from '@/components/ui/Spinner'

// ---------------------------------------------------------------------------------------------
// Pure helpers (exported for tests)
// ---------------------------------------------------------------------------------------------

/**
 * Reads a stat input's text as a whole number. Returns `null` for anything that isn't one yet
 * (empty, a lone "-", "1.5"), so a half-typed value blocks Apply instead of saving garbage.
 */
export function parseStatInput(text: string): number | null {
  const trimmed = text.trim()
  if (!/^-?\d+$/.test(trimmed)) return null
  const n = Number(trimmed)
  return Number.isSafeInteger(n) ? n : null
}

/** The edit state the card keeps: stat inputs as raw text (so "-" can be typed), fields as text. */
export interface UpdateEdits {
  stats: Record<string, string>
  fields: Record<string, string>
}

/** Seeds the edit state from the draft's proposed `after` values. */
export function initialEdits(draft: CharacterUpdateDraft): UpdateEdits {
  return {
    stats: Object.fromEntries((draft.stats ?? []).map((s) => [s.id, String(s.after)])),
    fields: Object.fromEntries((draft.fields ?? []).map((f) => [f.key, f.after])),
  }
}

/** True when every stat input is a whole number. */
export function editsAreValid(draft: CharacterUpdateDraft, edits: UpdateEdits): boolean {
  return (draft.stats ?? []).every((s) => parseStatInput(edits.stats[s.id] ?? '') !== null)
}

/** The draft with the edited values as its `after`s. Assumes `editsAreValid`; an invalid stat keeps its proposal. */
export function applyEdits(draft: CharacterUpdateDraft, edits: UpdateEdits): CharacterUpdateDraft {
  return {
    ...draft,
    ...(draft.stats && {
      stats: draft.stats.map((s) => ({ ...s, after: parseStatInput(edits.stats[s.id] ?? '') ?? s.after })),
    }),
    ...(draft.fields && {
      fields: draft.fields.map((f) => ({ ...f, after: edits.fields[f.key] ?? f.after })),
    }),
  }
}

/** A stat row differs from what's saved. A stat with no saved value always counts as a change. */
export function statChanged(stat: { before?: number; after: number }): boolean {
  return stat.before === undefined || stat.before !== stat.after
}

/** A field differs from what's saved. */
export function fieldChanged(field: { before: string; after: string }): boolean {
  return field.before !== field.after
}

/** True when applying the draft would change anything on the character. */
export function draftHasChanges(draft: CharacterUpdateDraft): boolean {
  return (draft.stats ?? []).some(statChanged) || (draft.fields ?? []).some(fieldChanged)
}

// ---------------------------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------------------------

// Same control styling as `Field.tsx`, which doesn't export it.
const TEXTAREA_CLASS =
  'w-full resize-y rounded-xl bg-bg-sunken px-3 py-2.5 text-base leading-relaxed text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40 placeholder:text-text-muted/55 disabled:opacity-70 sm:py-2 sm:text-sm'

const STEP_BUTTON_CLASS =
  'flex h-9 w-8 shrink-0 items-center justify-center text-text-muted transition-colors hover:bg-accent/10 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40 sm:h-8 sm:w-7'

function formatAppliedAt(ms: number): string {
  const date = new Date(ms)
  const sameDay = date.toDateString() === new Date().toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * A proposed change to a saved character: stat values for one world's sheet and/or a few profile
 * fields. The writer edits the proposal in place and applies it; once applied it turns read-only.
 */
export function CharacterUpdateCard({
  draft,
  onApply,
  onOpenCharacter,
}: {
  draft: CharacterUpdateDraft
  /** Saves the (possibly edited) draft to the character. Rejects on failure. */
  onApply: (edited: CharacterUpdateDraft) => Promise<void>
  /** Optional: open the character in Cast (the lead wires a deep link). */
  onOpenCharacter?: (characterId: string) => void
}) {
  const baseId = useId()
  const [edits, setEdits] = useState<UpdateEdits>(() => initialEdits(draft))
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applied = draft.appliedAt !== undefined
  const stats = draft.stats ?? []
  const fields = draft.fields ?? []
  // Once applied, show what was saved (the draft's own values), not the local edit state.
  const shown = applied ? draft : applyEdits(draft, edits)
  const valid = applied || editsAreValid(draft, edits)
  const hasChanges = draftHasChanges(shown)
  const canApply = !applied && !applying && valid && hasChanges

  const setStat = (id: string, text: string) => {
    setEdits((e) => ({ ...e, stats: { ...e.stats, [id]: text } }))
    setError(null)
  }
  const stepStat = (id: string, fallback: number, delta: number) => {
    const current = parseStatInput(edits.stats[id] ?? '') ?? fallback
    setStat(id, String(current + delta))
  }
  const setField = (key: string, text: string) => {
    setEdits((e) => ({ ...e, fields: { ...e.fields, [key]: text } }))
    setError(null)
  }

  const apply = async () => {
    if (!canApply) return
    setApplying(true)
    setError(null)
    try {
      await onApply(applyEdits(draft, edits))
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save the changes.')
    } finally {
      setApplying(false)
    }
  }

  const locked = applied || applying

  return (
    <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-4" aria-labelledby={`${baseId}-title`} role="group">
      {/* Header */}
      <div className="flex items-start gap-2">
        <UserCog size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div id={`${baseId}-title`} className="font-display text-base font-semibold text-accent">
            Update {draft.characterName}
          </div>
          {stats.length > 0 && (
            <div className="text-[10px] uppercase tracking-[0.06em] text-text-muted/70">
              Character sheet{draft.worldName ? ` · ${draft.worldName}` : ''}
            </div>
          )}
        </div>
      </div>
      {draft.summary && <p className="mt-1 whitespace-pre-wrap text-xs text-text-muted">{draft.summary}</p>}

      {/* Stats */}
      {stats.length > 0 && (
        <div className="mt-3 border-t border-accent/20 pt-3">
          <div
            aria-hidden
            className="mb-1 hidden items-center gap-2 px-2 text-[10px] uppercase tracking-[0.06em] text-text-muted/70 sm:flex"
          >
            <span className="min-w-0 flex-1">Stat</span>
            <span className="w-10 text-right">Saved</span>
            <span className="w-4" />
            <span className="w-[6.5rem] text-center">New</span>
          </div>
          <ul className="space-y-1" aria-label="Stats">
            {stats.map((stat) => {
              const shownStat = shown.stats?.find((s) => s.id === stat.id) ?? stat
              const text = edits.stats[stat.id] ?? ''
              const invalid = !applied && parseStatInput(text) === null
              const changed = !invalid && statChanged(shownStat)
              const inputId = `${baseId}-stat-${stat.id}`
              const reasonId = stat.reason ? `${inputId}-reason` : undefined
              return (
                <li
                  key={stat.id}
                  className={`rounded-lg border-l-2 px-2 py-1.5 ${
                    changed ? 'border-accent bg-accent/10' : 'border-transparent'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 basis-24 break-words text-xs font-medium text-text">
                      {stat.name}
                      {changed && <span className="sr-only"> (changed)</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="w-10 text-right text-xs tabular-nums text-text-muted">
                        <span className="sr-only">Saved value </span>
                        {stat.before ?? '—'}
                      </span>
                      <ArrowRight size={12} className="w-4 shrink-0 text-text-muted/70" aria-hidden />
                      {applied ? (
                        <span className="w-[6.5rem] text-center text-sm font-medium tabular-nums text-text">
                          <span className="sr-only">New value </span>
                          {shownStat.after}
                        </span>
                      ) : (
                        <span
                          className={`flex w-[6.5rem] items-stretch overflow-hidden rounded-lg bg-bg-sunken ring-1 ${
                            invalid ? 'ring-danger/60' : 'ring-transparent focus-within:ring-accent/40'
                          }`}
                        >
                          <button
                            type="button"
                            className={STEP_BUTTON_CLASS}
                            onClick={() => stepStat(stat.id, stat.after, -1)}
                            disabled={locked}
                            aria-label={`Decrease ${stat.name}`}
                          >
                            <Minus size={12} aria-hidden />
                          </button>
                          <input
                            id={inputId}
                            type="text"
                            inputMode="numeric"
                            pattern="-?[0-9]*"
                            autoComplete="off"
                            value={text}
                            onChange={(e) => setStat(stat.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                                e.preventDefault()
                                stepStat(stat.id, stat.after, e.key === 'ArrowUp' ? 1 : -1)
                              }
                            }}
                            disabled={locked}
                            aria-label={`${stat.name} new value`}
                            aria-invalid={invalid || undefined}
                            aria-describedby={reasonId}
                            className="min-w-0 flex-1 bg-transparent text-center text-base tabular-nums text-text outline-none disabled:opacity-70 sm:text-sm"
                          />
                          <button
                            type="button"
                            className={STEP_BUTTON_CLASS}
                            onClick={() => stepStat(stat.id, stat.after, 1)}
                            disabled={locked}
                            aria-label={`Increase ${stat.name}`}
                          >
                            <Plus size={12} aria-hidden />
                          </button>
                        </span>
                      )}
                    </span>
                  </div>
                  {stat.reason && (
                    <p id={reasonId} className="mt-0.5 text-[11px] leading-snug text-text-muted">
                      {stat.reason}
                    </p>
                  )}
                  {invalid && <p className="mt-0.5 text-[11px] text-danger">Enter a whole number.</p>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Fields */}
      {fields.length > 0 && (
        <div className="mt-3 space-y-3 border-t border-accent/20 pt-3">
          {fields.map((field) => {
            const shownField = shown.fields?.find((f) => f.key === field.key) ?? field
            const changed = fieldChanged(shownField)
            const areaId = `${baseId}-field-${field.key}`
            return (
              <div key={field.key} className={`border-l-2 pl-2 ${changed ? 'border-accent' : 'border-transparent'}`}>
                {applied ? (
                  <div className="text-xs font-medium text-text">{field.label}</div>
                ) : (
                  <label htmlFor={areaId} className="text-xs font-medium text-text">
                    {field.label}
                    {changed && <span className="sr-only"> (changed)</span>}
                  </label>
                )}
                <details className="mt-1 text-xs text-text-muted">
                  <summary className="cursor-pointer select-none text-[11px] text-text-muted/80 hover:text-text">
                    Saved text
                  </summary>
                  <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-bg-sunken/60 p-2">
                    {field.before.trim() ? field.before : <span className="italic">(empty)</span>}
                  </p>
                </details>
                {applied ? (
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-text">
                    {shownField.after.trim() ? shownField.after : <span className="italic text-text-muted">(empty)</span>}
                  </p>
                ) : (
                  <textarea
                    id={areaId}
                    value={edits.fields[field.key] ?? ''}
                    onChange={(e) => setField(field.key, e.target.value)}
                    disabled={locked}
                    rows={Math.min(8, Math.max(3, (edits.fields[field.key] ?? '').split('\n').length + 1))}
                    aria-label={`${field.label} new text`}
                    className={`mt-1.5 ${TEXTAREA_CLASS}`}
                  />
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Footer */}
      <div className="mt-3 border-t border-accent/20 pt-3">
        {applied ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="inline-flex items-center gap-1 text-success">
              <Check size={13} aria-hidden />
              Saved to {draft.characterName}
              <span className="text-text-muted">· {formatAppliedAt(draft.appliedAt!)}</span>
            </span>
            {onOpenCharacter && (
              <button
                type="button"
                onClick={() => onOpenCharacter(draft.characterId)}
                className="rounded text-accent underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Open in Cast
              </button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              variant="primary"
              onClick={apply}
              disabled={!canApply}
              aria-busy={applying || undefined}
              className="inline-flex items-center gap-1.5"
            >
              {applying ? <Spinner className="text-xs" /> : <Check size={14} aria-hidden />}
              {applying ? 'Applying…' : `Apply to ${draft.characterName}`}
            </Button>
            {!hasChanges && valid && <span className="text-xs text-text-muted">Nothing to change</span>}
            {error && (
              <p role="alert" className="w-full text-xs text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
