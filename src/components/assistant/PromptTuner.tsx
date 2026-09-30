import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Eye, Lock, RotateCcw, Sparkles } from 'lucide-react'
import { charactersApi, chatsApi, messagesApi, worldsApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import type { TuningProposal } from '@/lib/assistant/promptTuning'
import type { Character } from '@/lib/characters/cardSpec'
import { newId } from '@/lib/id'
import { TUNABLE_PROMPT_IDS } from '@/lib/prompt/promptOverrides'
import { tunablePrompt } from '@/lib/prompt/tunable'
import { previewPrompt, sampleFrom, STAND_IN_SAMPLE, targetHistory, targetLabel, targetText, tuningPatch, type TuningSample, type TuningTarget } from '@/lib/prompt/tuning'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { diffLines, diffWords, hasChanges, type DiffPart } from '@/lib/text/diff'
import { estimateTokens } from '@/lib/tokenEstimate'
import type { WorldCard } from '@/lib/types'
import { revertRevision } from '@/lib/world/revisions'
import { Button } from '@/components/ui/Button'
import { SelectField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'

// Same control styling as `Field.tsx`, which doesn't export it.
const TEXTAREA_CLASS =
  'w-full resize-y rounded-xl bg-bg-sunken px-3 py-2.5 text-sm leading-relaxed text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40'

const targetKey = (t: TuningTarget) => (t.kind === 'engine' ? `engine:${t.id}` : t.kind === 'gmNotes' ? 'gmNotes' : t.kind === 'worldItem' ? `world:${t.itemId}` : `char:${t.characterId}:${t.itemId}`)

/** Kept, removed and added text, in the app's colors. */
export function DiffView({ parts, className = '' }: { parts: readonly DiffPart[]; className?: string }) {
  return (
    <p className={`whitespace-pre-wrap break-words text-xs leading-relaxed ${className}`}>
      {parts.map((part, i) => part.type === 'same'
        ? <span key={i} className="text-text-muted">{part.text}</span>
        : part.type === 'removed'
          ? <del key={i} className="rounded bg-danger/15 text-danger">{part.text}</del>
          : <ins key={i} className="rounded bg-success/15 text-success no-underline">{part.text}</ins>)}
    </p>
  )
}

/** What the model would receive on a sample turn, before and after the edit. */
function PromptPreview({ before, after, sampleNote, onClose }: { before: string; after: string; sampleNote: string; onClose: () => void }) {
  const [view, setView] = useState<'changes' | 'after'>('changes')
  const parts = useMemo(() => diffLines(before, after), [before, after])
  return (
    <Modal onClose={onClose} title="Prompt inspector: sample turn" size="2xl" scrollable>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <span><strong className="text-text">{estimateTokens(before)}</strong> tok before</span>
        <span><strong className="text-text">{estimateTokens(after)}</strong> tok after</span>
        <span>{sampleNote}</span>
      </div>
      <div className="mb-3 flex gap-2">
        <Button variant={view === 'changes' ? 'primary' : 'secondary'} onClick={() => setView('changes')}>Changes</Button>
        <Button variant={view === 'after' ? 'primary' : 'secondary'} onClick={() => setView('after')}>What the model receives</Button>
      </div>
      {view === 'changes'
        ? hasChanges(parts) ? <DiffView parts={parts} className="rounded-xl bg-bg-sunken p-4 font-mono" /> : <p className="text-sm text-text-muted">No change to what the model receives.</p>
        : <pre className="whitespace-pre-wrap break-words rounded-xl bg-bg-sunken p-4 font-mono text-xs text-text">{after}</pre>}
    </Modal>
  )
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Writer's Room: view and tune the prompts that drive play, per world. The engine's own prompts
 * (only their guidance; the guardrails are shown locked), the world's GM notes, and the world's and
 * its cast's prompt items. An edit can be typed or proposed by the assistant, reviewed as a diff,
 * previewed on a sample turn, applied, and reverted from its history.
 */
export function PromptTuner({
  onClose,
  propose,
}: {
  onClose: () => void
  propose: (input: { label: string; drives?: string; current: string; guardrails?: string[]; placeholder?: string; request: string }) => Promise<TuningProposal>
}) {
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const [pickedWorldId, setWorldId] = useState('')
  const [target, setTarget] = useState<TuningTarget>({ kind: 'engine', id: 'gm-style' })
  const [draft, setDraft] = useState('')
  const [request, setRequest] = useState('')
  const [proposal, setProposal] = useState<(TuningProposal & { busy?: boolean }) | { busy: true } | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sample, setSample] = useState<{ sample: TuningSample; note: string }>({ sample: STAND_IN_SAMPLE, note: 'Sample: a stand-in scene.' })

  // The first world until one is picked.
  const worldId = pickedWorldId || worlds[0]?.id || ''
  const world = worlds.find((w) => w.id === worldId) as WorldCard | undefined
  const cast = characters.filter((c) => c.worldId === worldId)
  const character = target.kind === 'characterItem' ? characters.find((c) => c.id === target.characterId) as Character | undefined : undefined
  const saved = world ? targetText(target, world, character) : ''
  const key = `${worldId}|${targetKey(target)}|${saved}`

  // A fresh draft whenever the target, or what it says, changes.
  useEffect(() => {
    setDraft(saved)
    setProposal(null)
    setRequest('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // The world's latest scene, as the sample turn for previews.
  useEffect(() => {
    let cancelled = false
    const castIds = new Set(cast.map((c) => c.id))
    void (async () => {
      try {
        const chats = (await chatsApi.list()).filter((c) => castIds.has(c.characterId)).sort((a, b) => b.updatedAt - a.updatedAt)
        const latest = chats[0]
        if (!latest) return !cancelled && setSample({ sample: STAND_IN_SAMPLE, note: 'Sample: a stand-in scene (this world has none yet).' })
        const player = characters.find((c) => c.id === latest.playerCharacterId)?.card.name ?? 'You'
        const found = sampleFrom(await messagesApi.listByChat(latest.id), player)
        if (!cancelled) setSample(found ? { sample: found, note: `Sample: the latest lines of "${latest.title}".` } : { sample: STAND_IN_SAMPLE, note: 'Sample: a stand-in scene.' })
      } catch {
        if (!cancelled) setSample({ sample: STAND_IN_SAMPLE, note: 'Sample: a stand-in scene.' })
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldId, cast.length])

  if (!world) {
    return (
      <div className="flex min-h-0 flex-1 flex-col p-6">
        <Button variant="ghost" onClick={onClose} className="inline-flex w-fit items-center gap-1.5"><ArrowLeft size={14} /> Writer's Room</Button>
        <p className="mt-4 text-sm text-text-muted">Make a world first. Its prompts can be tuned here.</p>
      </div>
    )
  }

  const engine = target.kind === 'engine' ? tunablePrompt(target.id) : undefined
  const label = targetLabel(target, world, character)
  const changed = draft !== saved
  const history = targetHistory(target, world, character)

  const save = async (text: string, from: 'draft' | 'revert', revisionId?: string) => {
    setSaving(true)
    try {
      // From the freshest copy, so a change made elsewhere meanwhile isn't lost.
      if (target.kind === 'characterItem') {
        const fresh = await charactersApi.get(target.characterId)
        if (!fresh) throw new Error('That character is no longer in your library.')
        await charactersApi.update(fresh.id, from === 'revert' ? revertRevision(fresh, revisionId!, Date.now(), newId) : tuningPatch(target, world, fresh, text, Date.now(), newId))
      } else {
        const fresh = await worldsApi.get(world.id)
        if (!fresh) throw new Error('That world is no longer in your library.')
        await worldsApi.update(fresh.id, from === 'revert' ? revertRevision(fresh, revisionId!, Date.now(), newId) : tuningPatch(target, fresh, undefined, text, Date.now(), newId))
      }
      toastSuccess(from === 'revert' ? 'Reverted.' : `Saved ${label}.`)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const ask = async () => {
    if (!request.trim()) return
    setProposal({ busy: true })
    try {
      setProposal(await propose({ label, drives: engine?.drives, current: draft, guardrails: engine?.guardrails, placeholder: engine?.placeholder, request }))
    } catch (e) {
      setProposal(null)
      toastError(errorMessage(e))
    }
  }

  const targets: { group: string; items: { target: TuningTarget; label: string }[] }[] = [
    { group: 'Engine prompts', items: TUNABLE_PROMPT_IDS.map((id) => ({ target: { kind: 'engine' as const, id }, label: tunablePrompt(id).label })) },
    { group: world.name, items: [
      { target: { kind: 'gmNotes' as const }, label: 'GM notes' },
      ...(world.promptItems ?? []).map((item) => ({ target: { kind: 'worldItem' as const, itemId: item.id }, label: item.name || 'Prompt item' })),
    ] },
    ...cast.filter((c) => c.promptItems?.length).map((c) => ({
      group: c.card.name,
      items: (c.promptItems ?? []).map((item) => ({ target: { kind: 'characterItem' as const, characterId: c.id, itemId: item.id }, label: item.name || 'Prompt item' })),
    })),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <aside className="shrink-0 border-b border-border p-3 md:w-64 md:overflow-y-auto md:border-b-0 md:border-r">
        <Button variant="ghost" onClick={onClose} className="mb-2 inline-flex items-center gap-1.5"><ArrowLeft size={14} /> Writer's Room</Button>
        <SelectField label="World" value={worldId} onChange={(e) => setWorldId(e.target.value)}>
          {worlds.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </SelectField>
        <nav aria-label="Prompts" className="mt-2 space-y-3">
          {targets.map((group) => (
            <div key={group.group}>
              <p className="px-2 text-[10px] font-semibold uppercase tracking-widest text-text-muted/70">{group.group}</p>
              {group.items.map((item) => {
                const active = targetKey(item.target) === targetKey(target)
                const tuned = item.target.kind === 'engine' && !!world.promptOverrides?.[item.target.id]
                return (
                  <button key={targetKey(item.target)} type="button" onClick={() => setTarget(item.target)} aria-current={active}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs ${active ? 'bg-bg-elevated text-text' : 'text-text-muted hover:text-text'}`}>
                    <span className="truncate">{item.label}</span>
                    {tuned && <span className="shrink-0 text-[10px] text-accent">Tuned</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
      </aside>

      <section className="min-h-0 flex-1 overflow-y-auto px-6 py-5" aria-label={label}>
        <div className="mx-auto max-w-3xl space-y-4">
          <div>
            <h1 className="font-display text-lg text-text">{label}</h1>
            {engine && <p className="text-xs text-text-muted">{engine.drives} {world.promptOverrides?.[engine.id] ? `Tuned for ${world.name}.` : 'Using the engine default.'}</p>}
          </div>

          {engine && (
            <div className="rounded-xl border border-border bg-bg-sunken p-3 text-xs">
              <p className="mb-1 flex items-center gap-1.5 font-medium text-text"><Lock size={12} /> Always in the prompt</p>
              <ul className="list-disc space-y-0.5 pl-5 text-text-muted">{engine.guardrails.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          )}

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-muted">{engine ? 'Guidance' : 'Text'}</span>
            <textarea aria-label={`${label} text`} className={TEXTAREA_CLASS} rows={9} value={draft} disabled={saving} onChange={(e) => setDraft(e.target.value)} />
            {engine?.placeholder && <span className="mt-1 block text-[11px] text-text-muted">{engine.placeholder}</span>}
          </label>

          <div className="rounded-xl border border-accent/30 bg-accent/5 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <TextField label="Ask for a change" className="min-w-0 flex-1" placeholder="Shorter, and end scenes on a hook" value={request}
                onChange={(e) => setRequest(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask() }} />
              <Button variant="secondary" disabled={!request.trim() || !!(proposal && 'busy' in proposal && proposal.busy)} onClick={() => void ask()} className="mb-1 inline-flex items-center gap-1.5">
                {proposal && 'busy' in proposal && proposal.busy ? <Spinner /> : <Sparkles size={14} />} Propose
              </Button>
            </div>
            {proposal && 'text' in proposal && (
              <div className="mt-3 space-y-2">
                {proposal.reasoning && <p className="text-xs text-text"><span className="font-medium">Why: </span>{proposal.reasoning}</p>}
                <DiffView parts={diffWords(draft, proposal.text)} className="rounded-lg bg-bg-sunken p-3" />
                <div className="flex gap-2">
                  <Button variant="primary" onClick={() => { setDraft(proposal.text); setProposal(null) }}>Use this</Button>
                  <Button variant="ghost" onClick={() => setProposal(null)}>Discard</Button>
                </div>
              </div>
            )}
          </div>

          {changed && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-text-muted">Changes from what's saved</p>
              <DiffView parts={diffWords(saved, draft)} className="rounded-lg bg-bg-sunken p-3" />
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setPreviewing(true)} className="inline-flex items-center gap-1.5"><Eye size={14} /> Preview on a sample turn</Button>
            <Button variant="primary" disabled={!changed || saving} onClick={() => void save(draft, 'draft')}>{saving ? 'Saving…' : 'Apply'}</Button>
            <Button variant="ghost" disabled={!changed || saving} onClick={() => setDraft(saved)}>Discard changes</Button>
            {engine && draft.trim() !== engine.defaultText.trim() && (
              <Button variant="ghost" disabled={saving} onClick={() => setDraft(engine.defaultText)}>Use the engine default</Button>
            )}
          </div>

          <div>
            <p className="mb-1 text-xs font-medium text-text-muted">History</p>
            {history.length ? (
              <ul className="space-y-1">
                {history.map((rev) => (
                  <li key={rev.id} className="flex items-center gap-2 rounded-lg bg-bg-sunken px-3 py-1.5 text-xs">
                    <span className="min-w-0 flex-1 truncate text-text">{rev.label}</span>
                    <span className="shrink-0 text-text-muted">{formatWhen(rev.at)}</span>
                    <Button variant="ghost" disabled={saving} onClick={() => void save('', 'revert', rev.id)} className="inline-flex shrink-0 items-center gap-1" aria-label={`Revert: ${rev.label}`}>
                      <RotateCcw size={12} /> Revert
                    </Button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-text-muted">No changes yet.</p>}
          </div>
        </div>
      </section>

      {previewing && (
        <PromptPreview
          before={previewPrompt(target, world, character, saved, sample.sample)}
          after={previewPrompt(target, world, character, draft, sample.sample)}
          sampleNote={sample.note}
          onClose={() => setPreviewing(false)}
        />
      )}
    </div>
  )
}
