import { createPortal } from 'react-dom'
import { Brain } from 'lucide-react'
import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, memoryExplorerApi } from '@/lib/api/client'
import { whyLabels } from './memoryWhy'
export function ReplyMemoriesMenu({ messageId, swipe }: { messageId: string; swipe: number }) {
  const [open, setOpen] = useState(false)
  return <>
    <details className="relative">
      <summary className="flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-md hover:bg-bg-sunken hover:text-text" aria-label="Memory actions" title="Memory actions"><Brain size={13} /></summary>
      <button className="absolute bottom-full right-0 z-30 mb-2 w-44 rounded-lg border border-border bg-bg-elevated p-3 text-left text-xs text-text themed-shadow" onClick={(e) => { setOpen(true); e.currentTarget.closest('details')?.removeAttribute('open') }}>Why these memories?</button>
    </details>
    {open && <ReplyMemoriesSheet key={`${messageId}:${swipe}`} messageId={messageId} swipe={swipe} onClose={() => setOpen(false)} />}
  </>
}
function ReplyMemoriesSheet({ messageId, swipe, onClose }: { messageId: string; swipe: number; onClose: () => void }) {
  const data = useApiQuery(['memories', 'messages'], () => memoryExplorerApi.recalls(messageId, swipe), [messageId, swipe])
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const names = new Map(characters.map((c) => [c.id, c.card.name]))
  return createPortal(<Modal title="Why these memories?" description={data ? `What ${names.get(data.characterId) || 'Someone'} was given for this reply.` : undefined} onClose={onClose} size="md" scrollable>
    {!data ? <p className="text-sm text-text-muted">Loading memories…</p> : !data.recorded ? <p className="text-sm text-text-muted">Not recorded for this reply.</p> : <ul className="space-y-4">
      {data.memories.map((m) => <li key={m.id} className="rounded-xl border border-border p-3">
        <p className="whitespace-pre-wrap break-words text-sm">{m.text}</p>
        {m.reasons && <div className="mt-2 flex flex-wrap gap-1">{whyLabels(m.reasons, m.reasons.aboutPresent.map((id) => names.get(id) || 'Someone')).map((label) => <span key={label} className="rounded-full bg-bg-sunken px-2 py-1 text-xs text-text-muted">{label}</span>)}</div>}
      </li>)}
    </ul>}
  </Modal>, document.body)
}
