import { useId, useState } from 'react'
import { Dices, RotateCcw } from 'lucide-react'
import type { RulesetDraft } from '@/lib/assistant/thread'
import { benchRoll } from '@/lib/assistant/ruleset'
import type { WorldCard } from '@/lib/types'
import { customNeedsTarget, describeBands, describeDice, randomFace, validateCustomResolver } from '@/lib/world/customRules'
import { adjudicationLabel, recordedRollLine, type GmTurn, type RecordedMove } from '@/lib/world/gm'
import { Button } from '@/components/ui/Button'
import { NumberField, SelectField, TextField } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/Spinner'

// Same control styling as `Field.tsx`, which doesn't export it.
const TEXTAREA_CLASS =
  'w-full resize-y rounded-xl bg-bg-sunken px-3 py-2.5 font-mono text-xs leading-relaxed text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40'

/**
 * A drafted game system: its dice and outcomes (or what still needs fixing), a test bench that rolls
 * a sample action and shows exactly what the GM would receive, and applying it to a world, which
 * can be undone.
 */
export function RulesetCard({
  draft,
  worlds,
  onEdit,
  onApply,
  onUndo,
  onTryGm,
}: {
  draft: RulesetDraft
  worlds: Pick<WorldCard, 'id' | 'name' | 'campaign'>[]
  /** Saves edited dice and outcomes, rechecked. */
  onEdit: (custom: unknown) => Promise<void>
  onApply: (worldId: string) => Promise<void>
  onUndo: () => Promise<void>
  /** Runs the test roll through the GM model. Rejects when no model answers. */
  onTryGm: (roll: RecordedMove, worldName: string) => Promise<GmTurn>
}) {
  const baseId = useId()
  const valid = !draft.errors.length
  const resolver = validateCustomResolver(draft.custom).resolver
  const [editing, setEditing] = useState(!valid)
  const [json, setJson] = useState(() => JSON.stringify(draft.custom, null, 2))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [moveIndex, setMoveIndex] = useState(0)
  const [value, setValue] = useState(2)
  const [target, setTarget] = useState('')
  const [action, setAction] = useState('')
  const [roll, setRoll] = useState<RecordedMove | null>(null)
  const [gm, setGm] = useState<{ busy: boolean; turn?: GmTurn; error?: string }>({ busy: false })
  const [worldId, setWorldId] = useState(draft.worldId ?? worlds[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const applied = draft.appliedAt !== undefined && draft.undoneAt === undefined
  const needsTarget = customNeedsTarget(resolver)
  const world = worlds.find((w) => w.id === worldId)
  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'That did not work.')
    } finally {
      setBusy(false)
    }
  }

  const checkEdit = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      setJsonError('That is not valid JSON yet.')
      return
    }
    setJsonError(null)
    void run(() => onEdit(parsed))
  }

  const rollTest = () => {
    setGm({ busy: false })
    try {
      setRoll(benchRoll(draft, moveIndex, value, needsTarget ? Number(target) : undefined, action, randomFace))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not roll.')
    }
  }

  const tryGm = async () => {
    if (!roll) return
    setGm({ busy: true })
    try {
      setGm({ busy: false, turn: await onTryGm(roll, world?.name ?? 'a test world') })
    } catch (err) {
      setGm({ busy: false, error: err instanceof Error ? err.message : 'The GM did not answer.' })
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-4" aria-labelledby={`${baseId}-title`} role="group">
      <div className="flex items-start gap-2">
        <Dices size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <div id={`${baseId}-title`} className="font-display text-base font-semibold text-accent">{draft.name}</div>
          <div className="text-[10px] uppercase tracking-[0.06em] text-text-muted/70">Ruleset draft</div>
        </div>
      </div>

      {resolver && (
        <div className="mt-3 border-t border-accent/20 pt-3 text-xs text-text">
          <p>{describeDice(resolver.dice)}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-muted">{describeBands(resolver).map((line) => <li key={line}>{line}</li>)}</ul>
        </div>
      )}
      {!valid && (
        <div className="mt-3 rounded-lg border border-danger/40 bg-danger/5 p-3 text-xs text-danger" role="alert">
          <p className="font-medium">Fix these before testing or applying:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">{draft.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      {(draft.stats.length > 0 || draft.moves.length > 0) && (
        <div className="mt-3 grid gap-3 border-t border-accent/20 pt-3 text-xs sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.06em] text-text-muted/70">Stats</p>
            <ul className="space-y-0.5">{draft.stats.map((s) => <li key={s.name}><span className="font-medium text-text">{s.name}</span>{s.description ? <span className="text-text-muted"> · {s.description}</span> : null}</li>)}</ul>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-[0.06em] text-text-muted/70">Moves</p>
            <ul className="space-y-0.5">{draft.moves.map((m) => <li key={m.name}><span className="font-medium text-text">{m.name}</span><span className="text-text-muted"> ({m.stat}) · when {m.trigger}</span></li>)}</ul>
          </div>
        </div>
      )}

      <div className="mt-3 border-t border-accent/20 pt-3">
        <button type="button" onClick={() => setEditing((v) => !v)} className="text-xs text-accent hover:underline" aria-expanded={editing}>
          {editing ? 'Hide dice and outcomes' : 'Edit dice and outcomes'}
        </button>
        {editing && (
          <div className="mt-2 space-y-2">
            <textarea aria-label="Dice and outcomes (JSON)" className={TEXTAREA_CLASS} rows={12} value={json} disabled={busy || applied}
              onChange={(e) => { setJson(e.target.value); setJsonError(null) }} />
            {jsonError && <p className="text-xs text-danger">{jsonError}</p>}
            <Button variant="secondary" disabled={busy || applied} onClick={checkEdit}>Check and save</Button>
          </div>
        )}
      </div>

      {valid && (
        <div className="mt-3 space-y-2 border-t border-accent/20 pt-3">
          <p className="text-[10px] uppercase tracking-[0.06em] text-text-muted/70">Test bench</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <SelectField label="Move" value={String(moveIndex)} onChange={(e) => setMoveIndex(Number(e.target.value))}>
              {draft.moves.map((m, i) => <option key={m.name} value={i}>{m.name}</option>)}
            </SelectField>
            <NumberField label={resolver?.dice.pool ? 'Stat (dice)' : 'Stat value'} min={-100} max={100} step={1} value={value} onChange={(e) => setValue(Number(e.target.value))} />
            {needsTarget && <NumberField label="Difficulty" min={-30} max={100} step={1} value={target} onChange={(e) => setTarget(e.target.value)} />}
          </div>
          <TextField label="Sample action" placeholder="I slip past the guard" value={action} onChange={(e) => setAction(e.target.value)} />
          <Button variant="secondary" className="inline-flex items-center gap-1.5" disabled={needsTarget && target.trim() === ''} onClick={rollTest}>
            <Dices size={14} /> Roll
          </Button>
          {roll && (
            <div className="space-y-2 rounded-lg bg-bg-sunken p-3 text-xs">
              <p className="text-text"><span className="font-semibold">{roll.degree}</span> <span className="text-text-muted">({roll.tier})</span> · {roll.detail}</p>
              <div>
                <p className="mb-0.5 text-[10px] uppercase tracking-[0.06em] text-text-muted/70">What the GM receives</p>
                <p className="whitespace-pre-wrap font-mono text-[11px] text-text-muted">{recordedRollLine(roll)}</p>
              </div>
              <Button variant="ghost" disabled={gm.busy} onClick={() => void tryGm()}>
                {gm.busy ? <><Spinner /> Asking the GM…</> : 'Try it on the GM'}
              </Button>
              {gm.error && <p className="text-danger">{gm.error}</p>}
              {gm.turn && (
                <div className="space-y-1 border-t border-border pt-2">
                  {gm.turn.adjudication && <p className="font-medium text-text">{adjudicationLabel(gm.turn.adjudication)}</p>}
                  {gm.turn.narration && <p className="whitespace-pre-wrap text-text">{gm.turn.narration}</p>}
                  {gm.turn.adjudication?.outcome && <p className="text-text-muted">{gm.turn.adjudication.outcome}</p>}
                  {!!gm.turn.corrections?.length && <p className="text-text-muted">Engine corrections: {gm.turn.corrections.join(' ')}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 space-y-2 border-t border-accent/20 pt-3">
        {applied ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-text">
            <span>Applied to {draft.appliedWorldName}.</span>
            <Button variant="ghost" className="inline-flex items-center gap-1.5" disabled={busy} onClick={() => void run(onUndo)}><RotateCcw size={13} /> Undo</Button>
          </div>
        ) : worlds.length ? (
          <>
            {draft.undoneAt !== undefined && <p className="text-xs text-text-muted">Undone. {draft.appliedWorldName}'s earlier rules are back.</p>}
            <SelectField label="Apply to world" value={worldId} onChange={(e) => setWorldId(e.target.value)}
              hint={world?.campaign?.moves.length ? `Replaces ${world.name}'s dice and its ${world.campaign.moves.length} move${world.campaign.moves.length === 1 ? '' : 's'}. You can undo it.` : 'Turns on rolls for outcomes. You can undo it.'}>
              {worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </SelectField>
            <Button variant="primary" disabled={!valid || busy || !worldId} onClick={() => void run(() => onApply(worldId))}>
              {busy ? 'Applying…' : 'Apply to world'}
            </Button>
          </>
        ) : <p className="text-xs text-text-muted">Make a world first, then apply these rules to it.</p>}
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      </div>
    </div>
  )
}
