import { useState } from 'react'
import { Check, Circle, MinusCircle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { BrandWordmark } from '@/components/ui/BrandMark'
import { NewChatDialog } from '@/components/chat/NewChatDialog'
import { TrashPanel } from '@/components/chat/TrashPanel'
import type { ViewId } from '@/components/layout/Sidebar'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatsApi } from '@/lib/api/client'
import { checklist, remaining, type SetupStepId } from '@/lib/setup/setup'
import { SetupWizard } from './SetupWizard'
import { useSetupFacts } from './useSetupFacts'

const STATE_LABEL = { done: 'Done', skipped: 'Skipped', todo: 'To do' } as const

/**
 * The Get set up checklist (#40): every setup step, ticked when what it sets up exists, each one
 * reopening the wizard at that step. Lives in Settings, and on the empty Stories screen.
 */
export function SetupChecklist({ onStarted, onNavigate }: { onStarted: (chatId: string) => void; onNavigate: (view: ViewId) => void }) {
  const facts = useSetupFacts()
  const progress = useSettingsStore((s) => s.setupProgress)
  const [opening, setOpening] = useState<SetupStepId | null>(null)
  const items = checklist(facts, progress)
  const left = remaining(facts, progress)
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        {left === 0 ? 'All set. Reopen any step to change it.' : `${left} ${left === 1 ? 'step' : 'steps'} left.`}
      </p>
      <ol className="divide-y divide-border rounded-xl border border-border">
        {items.map(({ step, state }) => (
          <li key={step.id} className="flex items-center gap-3 p-3">
            {state === 'done'
              ? <Check size={16} className="shrink-0 text-success" aria-hidden="true" />
              : state === 'skipped'
                ? <MinusCircle size={16} className="shrink-0 text-text-muted" aria-hidden="true" />
                : <Circle size={16} className="shrink-0 text-text-muted" aria-hidden="true" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm text-text">{step.title}{step.optional && <span className="ml-1.5 text-xs text-text-muted">optional</span>}</div>
              <div className="text-xs text-text-muted">{step.summary}</div>
            </div>
            <span className="sr-only">{STATE_LABEL[state]}</span>
            <Button variant={state === 'todo' ? 'primary' : 'ghost'} onClick={() => setOpening(step.id)}>
              {state === 'done' ? 'Change' : 'Set up'}
            </Button>
          </li>
        ))}
      </ol>
      <button onClick={() => setOpening('welcome')} className="text-xs text-text-muted hover:text-text">Run the whole setup again</button>
      {opening && (
        <SetupWizard variant="overlay" initialStep={opening} onClose={() => setOpening(null)}
          onStarted={(id) => { setOpening(null); onStarted(id) }}
          onNavigate={(view) => { setOpening(null); onNavigate(view) }} />
      )}
    </div>
  )
}

/** The Stories screen with no stories, once the wizard was put off or finished: start one, or carry on setting up. */
export function GetStartedHome({ onStarted, onNavigate }: { onStarted: (chatId: string) => void; onNavigate: (view: ViewId) => void }) {
  const [newStory, setNewStory] = useState(false)
  const [showTrash, setShowTrash] = useState(false)
  const trashCount = useApiQuery('chats', () => chatsApi.trash(), [])?.length ?? 0
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-xl px-4 py-10 sm:px-6">
        <BrandWordmark />
        <h1 className="mt-4 font-display text-2xl text-text">No stories yet</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => setNewStory(true)}>Start a story</Button>
          <Button onClick={() => onNavigate('cast')}>Open Cast</Button>
        </div>
        <h2 className="mt-8 mb-2 text-sm font-medium text-text">Get set up</h2>
        <SetupChecklist onStarted={onStarted} onNavigate={onNavigate} />
        {trashCount > 0 && (
          <button onClick={() => setShowTrash(true)} className="mt-6 flex items-center gap-1.5 text-xs text-text-muted hover:text-text">
            <Trash2 size={12} strokeWidth={2} />
            {trashCount === 1 ? '1 deleted story in the trash' : `${trashCount} deleted stories in the trash`}
          </button>
        )}
      </div>
      {newStory && <NewChatDialog onClose={() => setNewStory(false)} onCreated={(id) => { setNewStory(false); onStarted(id) }} />}
      {showTrash && <TrashPanel onClose={() => setShowTrash(false)} onRestored={(id) => { setShowTrash(false); onStarted(id) }} />}
    </div>
  )
}
