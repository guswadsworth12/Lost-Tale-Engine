import { useEffect, useMemo, useState } from 'react'
import { Copy } from 'lucide-react'
import type { Chat, StoredMessage, Story } from '@/lib/types'
import { messagesApi } from '@/lib/api/client'
import { sceneLabel } from '@/lib/story/recaps'
import { messageDisplayText, sceneLocation, transcriptAsText, transcriptScenes } from '@/lib/story/library'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

type Loaded = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; messages: StoredMessage[] }

/**
 * A read-only reader for a story: every scene leading to `fromSceneId`, then that scene, each with
 * its recap and transcript. Only that scene's own past is shown, so a parallel storyline reads as
 * the path that led to it.
 */
export function StoryTranscript({ open, onClose, story, scenes, fromSceneId }: {
  open: boolean
  onClose: () => void
  story?: Story
  scenes: Chat[]
  fromSceneId?: string
}) {
  const path = useMemo(() => transcriptScenes(scenes, fromSceneId), [scenes, fromSceneId])
  const pathKey = path.map((s) => s.id).join(',')
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({})

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoaded(Object.fromEntries(path.map((s) => [s.id, { status: 'loading' } as Loaded])))
    for (const scene of path) {
      messagesApi.listByChat(scene.id)
        .then((messages) => { if (!cancelled) setLoaded((prev) => ({ ...prev, [scene.id]: { status: 'ready', messages } })) })
        .catch((e) => { if (!cancelled) setLoaded((prev) => ({ ...prev, [scene.id]: { status: 'error', message: errorMessage(e) } })) })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pathKey])

  if (!open) return null
  const title = story?.title?.trim() || path[path.length - 1]?.title || 'Story'
  const allReady = path.length > 0 && path.every((s) => loaded[s.id]?.status === 'ready')

  const copy = async () => {
    const parts = path.map((scene) => {
      const entry = loaded[scene.id]
      return { scene, messages: entry?.status === 'ready' ? entry.messages : [] }
    })
    try {
      await navigator.clipboard.writeText(transcriptAsText(title, parts))
      toastSuccess('Story copied as text.')
    } catch (e) { toastError(errorMessage(e)) }
  }

  return (
    <Modal onClose={onClose} title={title} size="3xl" scrollable
      description={path.length > 1 ? `${path.length} scenes, read from the beginning.` : 'The story so far.'}
      headerExtra={<Button variant="ghost" onClick={copy} disabled={!allReady} className="flex items-center gap-1.5" title="Copy the whole story as plain text"><Copy size={14} aria-hidden="true" />Copy as text</Button>}>
      <div className="-mx-1 min-h-0 flex-1 space-y-8 overflow-y-auto px-1" tabIndex={0} aria-label="Story transcript">
        {path.map((scene) => {
          const location = sceneLocation(scene)
          const entry = loaded[scene.id]
          const recap = scene.recap?.text?.trim()
          return (
            <article key={scene.id} aria-labelledby={`transcript-${scene.id}`}>
              <h3 id={`transcript-${scene.id}`} className="font-display text-base text-text">
                {sceneLabel(scene)}{location && <span className="text-text-muted"> · {location}</span>}
              </h3>
              {recap && <p className="mt-2 whitespace-pre-wrap rounded-xl bg-bg-sunken p-3 text-xs leading-relaxed text-text-muted"><span className="font-medium text-text">Recap: </span>{recap}</p>}
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-text">
                {!entry || entry.status === 'loading'
                  ? <p className="text-xs text-text-muted" role="status">Loading scene…</p>
                  : entry.status === 'error'
                    ? <p className="text-xs text-danger">Couldn't load this scene: {entry.message}</p>
                    : <SceneMessages messages={entry.messages} />}
              </div>
            </article>
          )
        })}
      </div>
    </Modal>
  )
}

function SceneMessages({ messages }: { messages: StoredMessage[] }) {
  const lines = messages.map((m) => ({ id: m.id, role: m.role, name: m.name, text: messageDisplayText(m) })).filter((m) => m.text)
  if (!lines.length) return <p className="text-xs text-text-muted">Nothing was said in this scene.</p>
  return <>
    {lines.map((m) => (
      <p key={m.id} className="whitespace-pre-wrap break-words">
        <span className={`font-medium ${m.role === 'user' ? 'text-accent' : 'text-text'}`}>{m.name}</span>
        <span className="text-text-muted">: </span>{m.text}
      </p>
    ))}
  </>
}
