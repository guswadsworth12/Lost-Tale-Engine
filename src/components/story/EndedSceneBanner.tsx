import { ArrowRight, BookOpen } from 'lucide-react'
import type { Chat } from '@/lib/types'
import { sceneLabel } from '@/lib/story/recaps'
import { Button } from '@/components/ui/Button'

/**
 * Sits above the composer of a scene that has ended: an ended scene is read-only history, so this
 * says so, keeps its recap a click away, and points on to the scene that continues from it.
 */
export function EndedSceneBanner({ scene, nextScene, onOpenScene }: {
  scene: Chat
  nextScene?: Chat
  onOpenScene?: (chatId: string) => void
}) {
  const recap = scene.recap?.text?.trim()
  const threads = scene.recap?.openThreads?.filter((t) => t.trim()) ?? []
  return (
    <section aria-label="Scene ended" className="w-full rounded-xl border border-border bg-bg-elevated/90 px-3 py-2 text-sm text-text backdrop-blur-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <BookOpen size={15} className="shrink-0 text-text-muted" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">This scene has ended.</span>{' '}
          <span className="text-xs text-text-muted">{sceneLabel(scene)} is kept as read-only history.</span>
        </p>
        {nextScene && onOpenScene && (
          <Button variant="primary" onClick={() => onOpenScene(nextScene.id)} className="flex w-full items-center justify-center gap-1.5 sm:w-auto">
            Continue in {sceneLabel(nextScene)} <ArrowRight size={14} aria-hidden="true" />
          </Button>
        )}
      </div>
      {recap && (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-xs text-text-muted hover:text-text">Recap</summary>
          <p className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-text-muted">{recap}</p>
          {threads.length > 0 && <p className="mt-1.5 text-xs text-text-muted"><span className="font-medium text-text">Still unresolved:</span> {threads.join('; ')}</p>}
        </details>
      )}
    </section>
  )
}
