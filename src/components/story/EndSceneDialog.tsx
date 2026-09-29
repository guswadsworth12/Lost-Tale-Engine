import { useEffect, useId, useState, type ReactNode } from 'react'
import { Plus, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { errorMessage } from '@/lib/store/useToastStore'
import type { RecapDraft } from '@/lib/story/recapWriter'

export interface EndSceneConfirmInput {
  recapText: string
  openThreads: string[]
  canonFacts: string[]
  next: { title?: string; location?: string; presentIds: string[]; storylineId?: string; newStorylineName?: string }
  /** Set when the chapter ends too. */
  chapter?: { recapText: string; openThreads: string[]; next: { title?: string; goal?: string } }
}

/** The chapter this scene is in, for ending it along with the scene. */
export interface EndSceneChapter {
  /** e.g. "Chapter 1 · The Fog" */
  label: string
  /** The number the next chapter would get. */
  nextNumber: number
  /** False when the chapter already ended in another branch: the scene can only carry on in it. */
  canEnd: boolean
  /** Drafts the chapter recap from its scenes, this one as its recap reads now. */
  onDraft: (scene: { recapText: string; openThreads: string[] }) => Promise<{ text: string; openThreads: string[]; fallback?: string }>
}

interface EndSceneDialogProps {
  open: boolean
  onClose: () => void
  drafting: boolean
  draft: RecapDraft | null
  error?: string
  onRedraft: () => void
  /** e.g. "Scene 3 · The cistern" */
  sceneLabel: string
  /** AI cast who could be in the next scene (no player card). */
  cast: { id: string; name: string; present: boolean }[]
  leadId: string
  location?: string
  /** Includes the main storyline. */
  storylines: { id: string; name: string }[]
  currentStorylineId: string
  /** Confirmed consequences carried forward (read-only). */
  consequences: string[]
  /** Omitted: no chapter controls. */
  chapter?: EndSceneChapter
  onConfirm: (input: EndSceneConfirmInput) => Promise<void>
}

type StorylineMode = 'continue' | 'split'

const CHECK_ROW = 'flex cursor-pointer items-start gap-2.5 rounded-xl bg-bg-sunken px-3 py-2.5 text-sm'

function DialogSection({ title, description, action, children }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {action}
      </div>
      {description && <p className="mb-3 text-xs text-text-muted">{description}</p>}
      {children}
    </section>
  )
}

/**
 * Ends the current scene: review the drafted recap, pick which lasting changes become world canon,
 * and set up who and where the next scene starts. The recap draft itself is written by the caller
 * (`writeSceneRecap`); this dialog only edits and confirms it.
 */
export function EndSceneDialog({
  open,
  onClose,
  drafting,
  draft,
  error,
  onRedraft,
  sceneLabel,
  cast,
  leadId,
  location,
  storylines,
  currentStorylineId,
  consequences,
  chapter,
  onConfirm,
}: EndSceneDialogProps) {
  const ids = useId()
  const [recapText, setRecapText] = useState('')
  const [threads, setThreads] = useState<string[]>([])
  const [newThread, setNewThread] = useState('')
  const [canon, setCanon] = useState<Set<number>>(new Set())
  const [title, setTitle] = useState('')
  const [nextLocation, setNextLocation] = useState(location ?? '')
  const [presentIds, setPresentIds] = useState<Set<string>>(() => initialPresent(cast, leadId))
  const [mode, setMode] = useState<StorylineMode>('continue')
  const [storylineName, setStorylineName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [endChapter, setEndChapter] = useState(false)
  const [chapterRecap, setChapterRecap] = useState('')
  const [chapterThreads, setChapterThreads] = useState('')
  const [draftingChapter, setDraftingChapter] = useState(false)
  const [chapterNote, setChapterNote] = useState('')
  const [nextChapterTitle, setNextChapterTitle] = useState('')
  const [nextChapterGoal, setNextChapterGoal] = useState('')

  // A fresh draft (first one, or a rewrite) replaces the recap section's edits.
  useEffect(() => {
    setRecapText(draft?.text ?? '')
    setThreads(draft?.openThreads ?? [])
    setCanon(new Set())
  }, [draft])

  // Each time the dialog opens, the next-scene setup starts from the current scene.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setNextLocation(location ?? '')
    setPresentIds(initialPresent(cast, leadId))
    setMode('continue')
    setStorylineName('')
    setSubmitError(null)
    setNewThread('')
    setEndChapter(false)
    setChapterRecap('')
    setChapterThreads('')
    setChapterNote('')
    setNextChapterTitle('')
    setNextChapterGoal('')
    // Only on open: re-seeding on every prop change would wipe choices mid-edit.
  }, [open])

  if (!open) return null

  const currentStoryline = storylines.find((s) => s.id === currentStorylineId)?.name ?? 'Main story'
  const lastingChanges = draft?.lastingChanges ?? []
  const splitNameMissing = mode === 'split' && !storylineName.trim()
  const endingChapter = endChapter && !!chapter?.canEnd
  const canConfirm = !drafting && !submitting && !!recapText.trim() && !splitNameMissing && (!endingChapter || (!draftingChapter && !!chapterRecap.trim()))

  const draftChapter = async () => {
    if (!chapter) return
    setDraftingChapter(true)
    setChapterNote('')
    try {
      const draft = await chapter.onDraft({ recapText: recapText.trim(), openThreads: threads.map((t) => t.trim()).filter(Boolean) })
      setChapterRecap(draft.text)
      setChapterThreads(draft.openThreads.join('\n'))
      if (draft.fallback) setChapterNote(`The model couldn't write it (${draft.fallback}), so the scene recaps were joined. Edit them into one.`)
    } catch (e) {
      setChapterNote(`Couldn't draft the chapter recap: ${errorMessage(e)}`)
    } finally {
      setDraftingChapter(false)
    }
  }

  const togglePresent = (id: string) => {
    if (id === leadId) return
    setPresentIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCanon = (index: number) => {
    setCanon((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const addThread = () => {
    const line = newThread.trim()
    if (!line) return
    setThreads((prev) => [...prev, line])
    setNewThread('')
  }

  const confirm = async () => {
    if (!canConfirm) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await onConfirm({
        recapText: recapText.trim(),
        openThreads: threads.map((t) => t.trim()).filter(Boolean),
        canonFacts: lastingChanges.filter((_, i) => canon.has(i)).map((c) => c.trim()).filter(Boolean),
        next: {
          title: title.trim() || undefined,
          location: nextLocation.trim() || undefined,
          presentIds: [leadId, ...cast.map((c) => c.id).filter((id) => id !== leadId && presentIds.has(id))],
          storylineId: mode === 'continue' ? currentStorylineId : undefined,
          newStorylineName: mode === 'split' ? storylineName.trim() : undefined,
        },
        ...(endingChapter ? { chapter: {
          recapText: chapterRecap.trim(),
          openThreads: chapterThreads.split('\n').map((t) => t.trim()).filter(Boolean),
          next: { title: nextChapterTitle.trim() || undefined, goal: nextChapterGoal.trim() || undefined },
        } } : {}),
      })
    } catch (e) {
      setSubmitError(errorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const closeUnlessBusy = () => {
    if (!submitting) onClose()
  }

  return (
    <Modal
      onClose={closeUnlessBusy}
      title={`End ${sceneLabel}`}
      description="The next scene starts fresh with a short history. It keeps this recap, the story's relationships, objectives and facts. Characters only hear recaps of scenes they were in."
      size="xl"
      scrollable
      hideHeaderClose
    >
      <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto px-1 pb-1">
        {/* 1. Recap */}
        <DialogSection
          title="Recap"
          action={
            <Button onClick={onRedraft} disabled={drafting || submitting} className="flex items-center gap-1.5">
              <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />
              Rewrite
            </Button>
          }
        >
          {drafting ? (
            <div role="status" className="flex items-center gap-2 rounded-xl bg-bg-sunken px-3 py-6 text-sm text-text-muted">
              <Spinner />
              Writing the recap…
            </div>
          ) : error ? (
            <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-danger/10 px-3 py-2.5 text-sm text-danger">
              <span className="min-w-0">Couldn't write the recap: {error}</span>
              <Button variant="secondary" onClick={onRedraft}>
                Try again
              </Button>
            </div>
          ) : null}
          {!drafting && (
            <TextAreaField
              label="What happened"
              rows={6}
              value={recapText}
              onChange={(e) => setRecapText(e.target.value)}
              placeholder={error ? 'Write the recap yourself, or try again.' : 'A short past-tense recap of this scene.'}
              hint="Later scenes see this instead of the transcript."
            />
          )}

          <fieldset>
            <legend className="mb-1 text-xs font-medium text-text-muted">Open threads</legend>
            {threads.length === 0 && <p className="mb-2 text-xs text-text-muted">No open threads.</p>}
            <ul className="mb-2 space-y-1.5">
              {threads.map((thread, i) => (
                <li key={i} className="flex items-center gap-2">
                  <input
                    aria-label={`Open thread ${i + 1}`}
                    value={thread}
                    onChange={(e) => setThreads((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))}
                    className="min-w-0 flex-1 rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:py-2 sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setThreads((prev) => prev.filter((_, j) => j !== i))}
                    aria-label={`Remove open thread ${i + 1}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <X size={15} strokeWidth={2} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <input
                aria-label="New open thread"
                value={newThread}
                onChange={(e) => setNewThread(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addThread()
                  }
                }}
                placeholder="Add an unresolved question or promise"
                className="min-w-0 flex-1 rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent placeholder:text-text-muted/55 focus:ring-accent/40 sm:py-2 sm:text-sm"
              />
              <Button onClick={addThread} disabled={!newThread.trim()} className="flex shrink-0 items-center gap-1.5">
                <Plus size={15} strokeWidth={2} aria-hidden="true" />
                Add
              </Button>
            </div>
          </fieldset>
        </DialogSection>

        {/* 2. Lasting changes */}
        <DialogSection title="Lasting changes" description="Canon is true in every story in this world, not just this one.">
          {drafting ? (
            <p className="text-xs text-text-muted">Waiting for the recap…</p>
          ) : lastingChanges.length === 0 ? (
            <p className="text-xs text-text-muted">Nothing from this scene looks like lasting world canon.</p>
          ) : (
            <ul className="space-y-1.5">
              {lastingChanges.map((change, i) => (
                <li key={`${i}-${change}`}>
                  <label className={CHECK_ROW}>
                    <input type="checkbox" checked={canon.has(i)} onChange={() => toggleCanon(i)} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-text">{change}</span>
                      <span className="block text-xs text-text-muted">Record as world canon</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </DialogSection>

        {consequences.length > 0 && (
          <DialogSection title="Carried forward" description="Confirmed consequences the next scene inherits.">
            <ul className="list-disc space-y-1 pl-5 text-sm text-text-muted">
              {consequences.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </DialogSection>
        )}

        {chapter && (
          <DialogSection title="Chapter" description={chapter.canEnd ? undefined : `${chapter.label} already ended in another branch. This scene carries on in it.`}>
            {chapter.canEnd && <>
              <label className={CHECK_ROW}>
                <input type="checkbox" checked={endChapter} className="mt-0.5" onChange={(e) => {
                  setEndChapter(e.target.checked)
                  if (e.target.checked && !chapterRecap.trim()) void draftChapter()
                }} />
                <span className="min-w-0">
                  <span className="block text-text">Also end {chapter.label}</span>
                  <span className="block text-xs text-text-muted">The chapter keeps a recap of its scenes, and the next scene opens Chapter {chapter.nextNumber}.</span>
                </span>
              </label>
              {endChapter && <div className="mt-3 space-y-3">
                {draftingChapter ? (
                  <div role="status" className="flex items-center gap-2 rounded-xl bg-bg-sunken px-3 py-6 text-sm text-text-muted"><Spinner />Writing the chapter recap…</div>
                ) : <>
                  <div className="flex justify-end">
                    <Button onClick={draftChapter} disabled={submitting || !recapText.trim()} className="flex items-center gap-1.5">
                      <RefreshCw size={14} strokeWidth={2} aria-hidden="true" />Rewrite
                    </Button>
                  </div>
                  {chapterNote && <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-text">{chapterNote}</p>}
                  <TextAreaField label="Chapter recap" rows={6} value={chapterRecap} onChange={(e) => setChapterRecap(e.target.value)}
                    hint="Later chapters hear this instead of the chapter's scenes." placeholder="A short past-tense account of the whole chapter." />
                  <TextAreaField label="Left open, one per line" rows={3} value={chapterThreads} onChange={(e) => setChapterThreads(e.target.value)} />
                </>}
                <div className="grid gap-x-3 sm:grid-cols-2">
                  <TextField label={`Chapter ${chapter.nextNumber} name (optional)`} value={nextChapterTitle} maxLength={120} onChange={(e) => setNextChapterTitle(e.target.value)} placeholder="Low Tide" />
                  <TextField label="Its goal (optional)" value={nextChapterGoal} maxLength={500} onChange={(e) => setNextChapterGoal(e.target.value)} placeholder="What the next chapter works toward" />
                </div>
              </div>}
            </>}
          </DialogSection>
        )}

        {/* 3. Next scene */}
        <DialogSection title={endingChapter ? `Next scene, the first of Chapter ${chapter!.nextNumber}` : 'Next scene'}>
          <div className="grid gap-x-3 sm:grid-cols-2">
            <TextField label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="The morning after" />
            <TextField label="Location" value={nextLocation} onChange={(e) => setNextLocation(e.target.value)} placeholder="Where it opens" />
          </div>

          {cast.length > 0 && (
            <fieldset className="mb-3">
              <legend className="mb-1 text-xs font-medium text-text-muted">Who's there</legend>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {cast.map((c) => {
                  const isLead = c.id === leadId
                  return (
                    <label key={c.id} className={`${CHECK_ROW} ${isLead ? 'cursor-default' : ''}`}>
                      <input
                        type="checkbox"
                        checked={isLead || presentIds.has(c.id)}
                        disabled={isLead}
                        onChange={() => togglePresent(c.id)}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 text-text">
                        {c.name}
                        {isLead && <span className="ml-1.5 text-xs text-text-muted">(lead, always there)</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="mb-1 text-xs font-medium text-text-muted">Storyline</legend>
            <div className="space-y-1.5">
              <label className={CHECK_ROW}>
                <input
                  type="radio"
                  name={`${ids}-storyline`}
                  checked={mode === 'continue'}
                  onChange={() => setMode('continue')}
                  className="mt-0.5"
                />
                <span className="min-w-0 text-text">Continue in {currentStoryline}</span>
              </label>
              <label className={CHECK_ROW}>
                <input
                  type="radio"
                  name={`${ids}-storyline`}
                  checked={mode === 'split'}
                  onChange={() => setMode('split')}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-text">Split off a parallel storyline</span>
                  <span className="block text-xs text-text-muted">A parallel storyline only knows what happened up to this point.</span>
                </span>
              </label>
            </div>
            {mode === 'split' && (
              <TextField
                label="New storyline name"
                value={storylineName}
                onChange={(e) => setStorylineName(e.target.value)}
                placeholder="Bram's road north"
                className="mt-3"
                autoFocus
              />
            )}
          </fieldset>
        </DialogSection>
      </div>

      <div className="mt-4 shrink-0 border-t border-border pt-4">
        {submitError && (
          <p role="alert" className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
            {submitError}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={confirm} disabled={!canConfirm} aria-busy={submitting} className="flex items-center gap-2">
            {submitting && <Spinner />}
            {endingChapter ? 'End chapter and continue' : 'End scene and continue'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function initialPresent(cast: { id: string; present: boolean }[], leadId: string): Set<string> {
  return new Set([leadId, ...cast.filter((c) => c.present).map((c) => c.id)])
}
