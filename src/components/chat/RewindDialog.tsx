import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { chatsApi, type RewindResult } from '@/lib/api/client'
import { PHASES, formatCalendarDate, getCalendarInfo } from '@/lib/world/calendar'
import { errorMessage } from '@/lib/store/useToastStore'
import type { WorldCard } from '@/lib/types'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * Confirms a rewind (#57) with what it will undo, read from a dry run: the messages, and the
 * memories, facts, relationship changes and objective progress that came with them. When the world
 * clock has moved since, it offers to put that back too: on by default only when no other story in
 * the world has played since, because every story there shares the clock.
 */
export function RewindDialog({ chatId, messageId, world, onRewind, onClose }: {
  chatId: string
  messageId: string
  world?: WorldCard
  onRewind: (opts: { restoreClock: boolean }) => Promise<unknown>
  onClose: () => void
}) {
  const [preview, setPreview] = useState<RewindResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [restoreClock, setRestoreClock] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    chatsApi.rewind(chatId, { messageId, dryRun: true })
      .then((result) => {
        if (cancelled) return
        setPreview(result)
        setRestoreClock(!!result.clock?.suggested)
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => { cancelled = true }
  }, [chatId, messageId])

  const confirm = async () => {
    setBusy(true)
    try {
      await onRewind({ restoreClock })
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const s = preview?.summary
  const clock = preview?.clock
  const clockLabel = clock ? `${PHASES[clock.phaseIndex] ?? 'morning'}, ${formatCalendarDate(getCalendarInfo(clock.day, world?.calendar))}` : ''
  const lines = s ? [
    plural(s.messages, 'message'),
    s.facts ? plural(s.facts, 'remembered fact') : '',
    s.relationshipChanges ? plural(s.relationshipChanges, 'relationship change') : '',
    s.objectivesRemoved ? plural(s.objectivesRemoved, 'new objective') : '',
    s.objectivesReopened ? `progress on ${plural(s.objectivesReopened, 'objective')}` : '',
    'the memories made from them',
  ].filter(Boolean) : []

  return (
    <Modal onClose={onClose} title="Rewind to here?" size="md" hideHeaderClose
      description="Deletes this message and everything after it, and takes the scene back to how it stood just before. Unlike forking, nothing removed is kept in the story.">
      <div className="space-y-4">
        {error && <p className="text-sm text-danger">{error}</p>}
        {!preview && !error && <div className="flex items-center gap-2 text-sm text-text-muted"><Loader2 size={14} className="animate-spin" /> Checking what this undoes…</div>}
        {s && (
          <div>
            <div className="mb-1 text-sm font-medium text-text">This removes</div>
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-text-muted">
              {lines.map((line) => <li key={line}>{line}</li>)}
            </ul>
            <p className="mt-2 text-sm text-text-muted">
              {s.stateRestored
                ? 'Relationships, gifts, the scene and tracked state go back to how they were.'
                : 'This message is older than full rewind, so relationships, gifts, the scene and tracked state stay as they are now.'}
            </p>
          </div>
        )}
        {clock && (
          <label className="flex items-start gap-2 rounded-xl bg-bg-sunken p-3 text-sm text-text">
            <input type="checkbox" className="mt-1" checked={restoreClock} onChange={(e) => setRestoreClock(e.target.checked)} />
            <span>
              Also set the world clock back to {clockLabel}
              <span className="block text-xs text-text-muted">
                {clock.suggested
                  ? 'Time has moved on since this message.'
                  : 'Another story in this world has been played since, and the clock is shared: leave this off to keep its time.'}
              </span>
            </span>
          </label>
        )}
        <p className="text-xs text-text-muted">A backup of everything is saved first, in the data folder's backups.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={!preview || busy} className="flex items-center gap-1.5">
            {busy && <Loader2 size={14} className="animate-spin" />} Rewind
          </Button>
        </div>
      </div>
    </Modal>
  )
}
