import { useMemoryIndexProgress } from '@/lib/hooks/useMemoryIndexer'

/** Session-only background progress, with a persistent Cancel until the user resumes. */
export function MemoryIndexProgress() {
  const progress = useMemoryIndexProgress()
  if (!progress.status) return null
  return <div className="mb-3 text-xs text-text-muted" role="status">
    <span>{progress.status} {progress.indexed > 0 || progress.remaining > 0 ? `${progress.indexed} prepared, ${progress.remaining} remaining.` : ''}</span>
    <button className="ml-2 underline" onClick={progress.cancelled ? progress.resume : progress.cancel}>
      {progress.cancelled ? 'Resume indexing' : 'Cancel indexing'}
    </button>
  </div>
}
