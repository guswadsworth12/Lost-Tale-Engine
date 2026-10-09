import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { PromptInspection } from '@/lib/prompt/inspection'
import { describeEntry } from '@/lib/worldinfo/activation'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { MemoryIndexProgress } from './MemoryIndexProgress'
import { whyLabels } from './memoryWhy'

export function PromptInspector({
  loadPrompt,
  summary,
  onUpdateSummary,
  onSaveSummary,
  onClose,
  lastReply,
}: {
  loadPrompt: () => Promise<PromptInspection | null>
  summary?: string
  onUpdateSummary: () => Promise<string | null>
  onSaveSummary: (text: string) => Promise<void>
  onClose: () => void
  /** The chat's latest character reply, processed (what's stored/rendered) vs. raw (the model's
   *  exact output, before scene-tag extraction) — `raw` is undefined for a reply generated before
   *  this field existed. Undefined entirely when the chat has no character message yet. */
  lastReply?: { processed: string; raw?: string }
}) {
  const [result, setResult] = useState<PromptInspection | null | 'error'>(null)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [editingSummary, setEditingSummary] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState(summary ?? '')
  const [savedSummary, setSavedSummary] = useState<string | undefined>(undefined)
  const [showRawReply, setShowRawReply] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadPrompt()
      .then((r) => !cancelled && setResult(r))
      .catch(() => !cancelled && setResult('error'))
    return () => {
      cancelled = true
    }
  }, [loadPrompt])

  const refreshSummary = async () => {
    setSummarizing(true)
    setSummaryError(null)
    try {
      const updated = await onUpdateSummary()
      if (updated !== null) setSavedSummary(updated)
      const r = await loadPrompt()
      setResult(r)
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : String(e))
    } finally {
      setSummarizing(false)
    }
  }

  const saveSummary = async () => {
    setSummaryError(null)
    try {
      await onSaveSummary(summaryDraft)
      setSavedSummary(summaryDraft.trim())
      setEditingSummary(false)
      setResult(await loadPrompt())
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal onClose={onClose} title="Prompt inspector" size="2xl" scrollable>
        {result === null && <p className="text-sm text-text-muted">Building…</p>}
        {result === 'error' && (
          <p className="text-sm text-danger">Couldn't build the prompt. Pick a character first.</p>
        )}
        {result && result !== 'error' && (
          <div className="flex-1 overflow-y-auto">
            <div className="mb-5 flex flex-wrap gap-4 text-xs text-text-muted">
              <span>
                <strong className="text-text">{result.tokensUsed}</strong> / {result.contextBudget} tok used
              </span>
              <span>
                <strong className="text-text">{result.includedMessageCount}</strong> messages included
              </span>
              {result.excludedMessageCount > 0 && (
                <span className="text-danger">{result.excludedMessageCount} older messages dropped (context full)</span>
              )}
            </div>

            {result.sectionBreakdown && result.sectionBreakdown.length > 0 && (
              <div className="mb-5 rounded-xl bg-bg-sunken p-4">
                <h3 className="mb-2 text-xs font-semibold text-text-muted">Where your tokens went</h3>
                <ul className="space-y-1.5">
                  {[...result.sectionBreakdown]
                    .sort((a, b) => b.tokens - a.tokens)
                    .map((section) => {
                      const pct = result.tokensUsed > 0 ? Math.round((section.tokens / result.tokensUsed) * 100) : 0
                      return (
                        <li key={section.id} className="flex items-center gap-3 text-xs">
                          <span className="w-44 shrink-0 truncate text-text">{section.label}</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-elevated">
                            <span className="block h-full rounded-full bg-accent/60" style={{ width: `${Math.max(pct, 2)}%` }} />
                          </span>
                          <span className="w-16 shrink-0 text-right text-text-muted">{section.tokens} tok</span>
                        </li>
                      )
                    })}
                </ul>
                <p className="mt-2 text-[11px] text-text-muted">
                  Each section counted on its own. These won't sum to exactly the total above (formatting between
                  sections adds a few tokens), close enough to see where it's actually going.
                </p>
              </div>
            )}

            <div className="mb-5 rounded-xl bg-bg-sunken p-4">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-text-muted">Long-term memory (summary)</h3>
                <Button variant="ghost" onClick={() => { setSummaryDraft(savedSummary ?? summary ?? ''); setEditingSummary(!editingSummary) }}>
                  {editingSummary ? 'Cancel' : 'Edit'}
                </Button>
                <Button variant="ghost" onClick={refreshSummary} disabled={summarizing} className="flex items-center gap-1.5">
                  <RotateCcw size={12} strokeWidth={2} className={summarizing ? 'animate-spin' : ''} />
                  {summarizing ? 'Updating…' : 'Update now'}
                </Button>
              </div>
              {summaryError && <p className="mb-2 text-xs text-danger">{summaryError}</p>}
              {editingSummary ? (
                <div>
                  <textarea className="w-full rounded border border-border bg-bg px-2 py-1 text-xs text-text" rows={8} value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)} aria-label="Edit long-term memory summary" />
                  <Button onClick={saveSummary}>Save summary</Button>
                  <p className="mt-1 text-xs text-text-muted">This edits the summary only. The transcript and memory checkpoint remain available.</p>
                </div>
              ) : (savedSummary ?? summary)?.trim() ? (
                <p className="text-xs text-text">{savedSummary ?? summary}</p>
              ) : (
                <p className="text-xs text-text-muted">
                  No summary yet. Once this chat has enough history, older turns are folded in here
                  automatically so they aren't just dropped when the context fills up.
                </p>
              )}
            </div>

            <h3 className="mb-1 text-xs font-semibold text-text-muted">
              World info activated ({result.activatedEntries.length})
            </h3>
            {result.activatedEntries.length === 0 ? (
              <p className="mb-5 text-xs text-text-muted">
                None matched the recent conversation yet. Add keywords, or set an entry to "Always".
              </p>
            ) : (
              <ul className="mb-5 space-y-1 text-xs">
                {/* Entry ids are only unique within one lorebook — the synthetic "Remembered
                    facts" book uses id 0,1,2… which collides with low ids from an imported
                    character/world book. This list is display-only and never reorders, so the
                    map index is a safe stable key. */}
                {result.activatedEntries.map((e, i) => (
                  <li key={i} className="rounded-lg bg-bg-sunken px-2.5 py-1.5">
                    <span className="font-medium text-text">{e.keys.join(', ') || '(no keys)'}</span>
                    <span className="text-text-muted"> · {e.content.slice(0, 80)}</span>
                  </li>
                ))}
              </ul>
            )}
            {result.droppedForBudget.length > 0 && (
              <p className="mb-5 text-xs text-danger">
                {result.droppedForBudget.length} entr{result.droppedForBudget.length === 1 ? 'y' : 'ies'} matched but
                didn't fit the lorebook's token budget: {result.droppedForBudget.map(describeEntry).join(', ')}
              </p>
            )}
            {result.droppedForGroup.length > 0 && (
              <p className="mb-5 text-xs text-text-muted">
                {result.droppedForGroup.length} entr{result.droppedForGroup.length === 1 ? 'y' : 'ies'} lost to a
                higher-priority entry in the same inclusion group: {result.droppedForGroup.map(describeEntry).join(', ')}
              </p>
            )}
            {result.styleGuidanceDroppedCount > 0 && (
              // The context window was too tight for every steering line at once — `buildPrompt`
              // dropped the least-essential ones (mood/need/plans texture, never content policy or
              // scene state) so the chat history it was steering didn't get squeezed out instead.
              <p className="mb-5 text-xs text-warning">
                Context is tight: {result.styleGuidanceDroppedCount} lower-priority steering{' '}
                {result.styleGuidanceDroppedCount === 1 ? 'line was' : 'lines were'} dropped to leave room for chat
                history. A larger context length keeps all of it.
              </p>
            )}

            {(result.examplePicks || result.exampleBankSkipped) && <section className="rounded-xl border border-border p-3">
              <h3 className="text-sm font-semibold">Example bank</h3>
              {result.exampleBankSkipped && <p className="mt-1 text-xs text-text-muted">{result.exampleBankSkipped}</p>}
              {result.examplePicks?.map((pick, index) => <div key={pick.entry.id} className="mt-2 text-xs">
                <p className="text-text-muted">Example {index + 1}: {[...pick.situations, ...(pick.similarMeaning ? ['similar meaning'] : []), ...(pick.fallback ? ['fallback'] : [])].join(', ')} · ~{pick.tokens} tokens</p>
                <p className="mt-1 whitespace-pre-wrap">{pick.entry.text}</p>
              </div>)}
            </section>}
            {result.memoryPicks && <MemoriesSection result={result} />}

            <h3 className="mb-1 text-xs font-semibold text-text-muted">Exact text sent to the model</h3>
            <pre className="whitespace-pre-wrap rounded-xl bg-bg-sunken p-4 text-xs text-text">{result.prompt}</pre>

            {lastReply && (
              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-text-muted">Latest reply</h3>
                  <div className="flex gap-1 rounded-lg bg-bg-sunken p-0.5 text-xs">
                    <button
                      onClick={() => setShowRawReply(false)}
                      className={`rounded-md px-2 py-1 transition-colors ${!showRawReply ? 'bg-accent/10 text-accent' : 'text-text-muted'}`}
                    >
                      Processed
                    </button>
                    <button
                      onClick={() => setShowRawReply(true)}
                      disabled={!lastReply.raw}
                      className={`rounded-md px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${showRawReply ? 'bg-accent/10 text-accent' : 'text-text-muted'}`}
                    >
                      Raw
                    </button>
                  </div>
                </div>
                {showRawReply && lastReply.raw ? (
                  <>
                    <p className="mb-2 text-xs text-text-muted">
                      Exactly what the model returned, before scene-tag extraction or any display regex script touches it.
                    </p>
                    <pre className="whitespace-pre-wrap rounded-xl bg-bg-sunken p-4 text-xs text-text">{lastReply.raw}</pre>
                  </>
                ) : (
                  <pre className="whitespace-pre-wrap rounded-xl bg-bg-sunken p-4 text-xs text-text">
                    {lastReply.processed || '(empty)'}
                  </pre>
                )}
                {!lastReply.raw && (
                  <p className="mt-2 text-xs text-text-muted">
                    Raw output isn't available for this reply. It was generated before this toggle existed.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
    </Modal>
  )
}

/** What this speaker recalls in the prompt and why, plus what the budget and the witness rule held back. */
function MemoriesSection({ result }: { result: PromptInspection }) {
  const picks = result.memoryPicks ?? []
  const skipped = result.memorySkipped ?? 0
  const hidden = result.memoryWitnessFilter?.hiddenMessages ?? 0
  return (
    <div className="mb-5">
      <h3 className="mb-1 text-xs font-semibold text-text-muted">Memories ({picks.length})</h3>
      <MemoryIndexProgress />
      {result.memoryMeaningSkipped && <p className="mb-2 text-xs text-text-muted">{result.memoryMeaningSkipped}</p>}
      {picks.length === 0 && !result.memoryJournal ? (
        <p className="mb-2 text-xs text-text-muted">No memories for this speaker yet.</p>
      ) : (
        <ul className="mb-2 space-y-1 text-xs">
          {picks.map((pick) => {
            const labels = whyLabels(pick.reasons, pick.aboutNames)
            return (
              <li key={pick.id} className="rounded-lg bg-bg-sunken px-2.5 py-1.5">
                <span className="text-text">{pick.text}</span>
                {labels.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {labels.map((label) => (
                      <span key={label} className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                        {label}
                      </span>
                    ))}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {skipped > 0 && (
        <p className="mb-2 text-xs text-text-muted">
          {skipped} more {skipped === 1 ? "memory didn't" : "memories didn't"} fit
        </p>
      )}
      {result.memoryJournal && (
        <details className="mb-2 rounded-lg bg-bg-sunken px-2.5 py-1.5 text-xs">
          <summary className="cursor-pointer text-text-muted">Journal</summary>
          <p className="mt-1 whitespace-pre-wrap text-text">{result.memoryJournal}</p>
        </details>
      )}
      {hidden > 0 && (
        <p className="mb-2 text-xs text-text-muted">
          {hidden} earlier {hidden === 1 ? 'message' : 'messages'} hidden: this speaker wasn't there
        </p>
      )}
    </div>
  )
}
