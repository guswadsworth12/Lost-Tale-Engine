import { useId, useState } from 'react'
import type { Story } from '@/lib/types'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { storiesApi } from '@/lib/api/client'
import { sceneLabel } from '@/lib/story/recaps'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { lastScene, sequelCandidates } from './sequel'

const selectClass = 'w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-text outline-none focus:border-accent'
const actionClass = 'rounded-lg border border-border px-3 py-1.5 text-xs text-text hover:bg-bg-sunken disabled:opacity-40'

/**
 * "Continues from": makes this story a sequel of another in the same world, from one of its scenes
 * (its last by default), so characters keep what they remembered by then (`Story.continuesFrom`).
 */
export function StorySequelLink({ story }: { story: Story }) {
  const headingId = useId()
  const stories = useApiQuery('stories', () => storiesApi.list(), [])
  const [storyId, setStoryId] = useState(story.continuesFrom?.storyId ?? '')
  // '' = that story's last scene.
  const [sceneId, setSceneId] = useState(story.continuesFrom?.sceneId ?? '')
  const [busy, setBusy] = useState(false)
  const scenes = useApiQuery(['stories', 'chats'], () => (storyId ? storiesApi.scenes(storyId) : Promise.resolve([])), [storyId])

  const candidates = sequelCandidates(stories ?? [], story)
  const missingCurrent = !!storyId && !!stories && !candidates.some((s) => s.id === storyId)
  const orderedScenes = [...(scenes ?? [])].sort((a, b) => (a.sceneNumber ?? 1) - (b.sceneNumber ?? 1) || a.createdAt - b.createdAt)
  const chosenScene = orderedScenes.find((s) => s.id === sceneId) ?? lastScene(orderedScenes)
  const next = storyId && chosenScene ? { storyId, sceneId: chosenScene.id } : null
  const saved = story.continuesFrom ?? null
  const changed = (next?.storyId ?? '') !== (saved?.storyId ?? '') || (next?.sceneId ?? '') !== (saved?.sceneId ?? '')
  const canSave = changed && !busy && (!storyId || !!next)

  const save = async () => {
    if (!canSave) return
    setBusy(true)
    try {
      await storiesApi.update(story.id, { continuesFrom: next })
      toastSuccess(next ? 'Sequel link saved.' : 'This story starts fresh now.')
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby={headingId} className="space-y-2 border-t border-border pt-4">
      <div>
        <h3 id={headingId} className="font-medium">Continues from</h3>
        <p className="mt-1 text-xs text-text-muted">Characters keep what they remembered by the end of that story. Leave empty for a fresh start.</p>
      </div>
      <label className="block space-y-1 text-xs text-text-muted">
        Story
        <select className={selectClass} value={storyId} onChange={(e) => { setStoryId(e.target.value); setSceneId('') }}>
          <option value="">None</option>
          {missingCurrent && <option value={storyId}>A story that no longer exists</option>}
          {candidates.map((s) => <option key={s.id} value={s.id}>{s.title || 'Untitled story'}</option>)}
        </select>
      </label>
      {storyId && (
        <label className="block space-y-1 text-xs text-text-muted">
          From scene
          <select className={selectClass} value={chosenScene?.id ?? ''} onChange={(e) => setSceneId(e.target.value)} disabled={!orderedScenes.length}>
            {!orderedScenes.length && <option value="">{scenes ? 'No scenes' : 'Loading…'}</option>}
            {orderedScenes.map((s) => <option key={s.id} value={s.id}>{sceneLabel(s)}</option>)}
          </select>
        </label>
      )}
      <button className={actionClass} disabled={!canSave} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
    </section>
  )
}
