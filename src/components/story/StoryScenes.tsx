import { useId, useState, type ReactNode } from 'react'
import { GitBranch, Pencil } from 'lucide-react'
import type { Chapter, Chat, Story } from '@/lib/types'
import { sceneLabel } from '@/lib/story/recaps'
import { sceneLocation, storyLanes } from '@/lib/story/library'
import { chapterIdOf, chapterLabel, chaptersOf, scenesOfChapter } from '@/lib/story/chapters'
import { StorySequelLink } from './StorySequelLink'

export interface ChapterEditInput {
  chapterId: string
  title: string
  goal: string
  /** Only for an ended chapter. */
  recap?: { text: string; openThreads: string[] }
}

/**
 * A story's timeline: its chapters, oldest first, each with its name, goal, and (once ended) its
 * recap and open threads; inside each, its scenes, one lane per storyline (the main line first),
 * each scene with where it happened, whether it's over, and its recap. Opening a scene hands its
 * chat id back. `onEditChapter` lets the player name a chapter, set its goal, or correct its recap.
 * `showSequelLink` adds the story's "Continues from" setting underneath.
 */
export function StoryScenes({ story, scenes, currentSceneId, onOpenScene, onEditChapter, showSequelLink = false }: {
  story?: Story
  scenes: Chat[]
  currentSceneId?: string
  onOpenScene?: (chatId: string) => void
  onEditChapter?: (edit: ChapterEditInput) => Promise<void>
  showSequelLink?: boolean
}) {
  const sequelLink = showSequelLink && story
    // Keyed on the saved link so the form resets when it changes underneath (another window, a refetch).
    ? <StorySequelLink key={`${story.id}:${story.continuesFrom?.storyId ?? ''}:${story.continuesFrom?.sceneId ?? ''}`} story={story} />
    : null
  if (!scenes.length) {
    const empty = <p className="text-xs text-text-muted">No scenes yet.</p>
    return sequelLink ? <div className="space-y-5">{empty}{sequelLink}</div> : empty
  }
  const current = scenes.find((scene) => scene.id === currentSceneId)
  const currentChapterId = current ? chapterIdOf(current) : undefined
  return (
    <div className="space-y-6">
      {chaptersOf(story, scenes).map((chapter) => {
        const chapterScenes = scenesOfChapter(scenes, chapter.id)
        const lanes = storyLanes(story, chapterScenes)
        return (
          <ChapterSection key={chapter.id} chapter={chapter} isCurrent={chapter.id === currentChapterId} onEdit={onEditChapter}>
            {lanes.length
              ? lanes.map((lane) => (
                <Lane key={lane.storylineId} name={lanes.length > 1 ? lane.name : undefined}
                  splitFrom={lane.splitFrom} scenes={lane.scenes} currentSceneId={currentSceneId} onOpenScene={onOpenScene} />
              ))
              : <p className="text-xs text-text-muted">No scenes in this branch yet.</p>}
          </ChapterSection>
        )
      })}
      {sequelLink}
    </div>
  )
}

const inputClass = 'w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-text outline-none focus:border-accent'

/** One chapter: its heading, status, goal, and recap, an edit form, then its scenes. */
export function ChapterSection({ chapter, isCurrent, onEdit, children }: {
  chapter: Chapter
  isCurrent: boolean
  onEdit?: (edit: ChapterEditInput) => Promise<void>
  children?: ReactNode
}) {
  const headingId = useId()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [recap, setRecap] = useState('')
  const [threads, setThreads] = useState('')
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState('')
  const threadsLeft = chapter.recap?.openThreads?.filter((t) => t.trim()) ?? []
  const status = isCurrent ? 'Here now' : chapter.endedAt ? 'Ended' : 'In progress'
  const startEditing = () => {
    setTitle(chapter.title ?? '')
    setGoal(chapter.goal ?? '')
    setRecap(chapter.recap?.text ?? '')
    setThreads(threadsLeft.join('\n'))
    setProblem('')
    setEditing(true)
  }
  const save = async () => {
    if (!onEdit) return
    setSaving(true)
    try {
      await onEdit({
        chapterId: chapter.id,
        title,
        goal,
        ...(chapter.endedAt ? { recap: { text: recap, openThreads: threads.split('\n').map((t) => t.trim()).filter(Boolean) } } : {}),
      })
      setEditing(false)
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <section aria-labelledby={headingId} aria-current={isCurrent ? 'step' : undefined} className="space-y-3">
      <div className={`rounded-xl border p-3 ${isCurrent ? 'border-accent/50 bg-accent/5' : 'border-border'}`}>
        <div className="flex items-start justify-between gap-2">
          <h3 id={headingId} className="text-sm font-semibold text-text">{chapterLabel(chapter)}</h3>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${isCurrent ? 'bg-accent/15 text-accent' : 'bg-bg-sunken text-text-muted'}`}>{status}</span>
            {onEdit && !editing && <button onClick={startEditing} aria-label={`Edit ${chapterLabel(chapter)}`} className="rounded-lg p-1 text-text-muted hover:bg-bg-sunken hover:text-text"><Pencil size={13} /></button>}
          </div>
        </div>
        {editing ? <div className="mt-2 space-y-2">
          <label className="block space-y-1 text-xs text-text-muted">Name<input className={inputClass} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="Low Tide" /></label>
          <label className="block space-y-1 text-xs text-text-muted">Goal<textarea className={`${inputClass} min-h-14`} value={goal} maxLength={500} onChange={(e) => setGoal(e.target.value)} placeholder="What this chapter is working toward" /></label>
          {chapter.endedAt && <>
            <label className="block space-y-1 text-xs text-text-muted">Recap<textarea className={`${inputClass} min-h-24`} value={recap} onChange={(e) => setRecap(e.target.value)} /></label>
            <label className="block space-y-1 text-xs text-text-muted">Left open, one per line<textarea className={`${inputClass} min-h-14`} value={threads} onChange={(e) => setThreads(e.target.value)} /></label>
          </>}
          {problem && <p role="alert" className="text-xs text-danger">{problem}</p>}
          <div className="flex gap-2">
            <button onClick={save} disabled={saving || (!!chapter.endedAt && !recap.trim())} className="rounded-lg border border-border px-3 py-1.5 text-xs text-text hover:bg-bg-sunken disabled:opacity-50">{saving ? 'Saving…' : 'Save chapter'}</button>
            <button onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-xs text-text-muted hover:text-text">Cancel</button>
          </div>
        </div> : <>
          {chapter.goal?.trim() && <p className="mt-1 text-xs text-text"><span className="text-text-muted">Goal: </span>{chapter.goal.trim()}</p>}
          {chapter.recap?.text.trim() && <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-text-muted">{chapter.recap.text.trim()}</p>}
          {threadsLeft.length > 0 && <div className="mt-2 text-xs text-text-muted">
            <p className="font-medium text-text">Left open</p>
            <ul className="list-disc pl-4">{threadsLeft.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>}
        </>}
      </div>
      <div className="pl-2">{children}</div>
    </section>
  )
}

function Lane({ name, splitFrom, scenes, currentSceneId, onOpenScene }: {
  name?: string
  splitFrom?: Chat
  scenes: Chat[]
  currentSceneId?: string
  onOpenScene?: (chatId: string) => void
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={name ? headingId : undefined} aria-label={name ? undefined : 'Scenes'}>
      {name && <h3 id={headingId} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-text-muted">
        {splitFrom && <GitBranch size={13} aria-hidden="true" />}{name}
      </h3>}
      {splitFrom && <p className="mt-0.5 text-xs text-text-muted">Split from {sceneLabel(splitFrom)}</p>}
      <ol className={`space-y-2 border-l border-border pl-3 ${name ? 'mt-2' : ''}`}>
        {scenes.map((scene) => (
          <SceneItem key={scene.id} scene={scene} isCurrent={scene.id === currentSceneId} onOpenScene={onOpenScene} />
        ))}
      </ol>
    </section>
  )
}

function SceneItem({ scene, isCurrent, onOpenScene }: { scene: Chat; isCurrent: boolean; onOpenScene?: (chatId: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const recapId = useId()
  const location = sceneLocation(scene)
  const recap = scene.recap?.text?.trim()
  const status = isCurrent ? (scene.endedAt ? 'Ended · open now' : 'Here now') : scene.endedAt ? 'Ended' : 'In progress'
  const label = sceneLabel(scene)
  return (
    <li aria-current={isCurrent ? 'step' : undefined}
      className={`relative rounded-xl border p-3 ${isCurrent ? 'border-accent/50 bg-accent/5' : 'border-border'}`}>
      <span aria-hidden="true" className={`absolute -left-[1.08rem] top-4 h-2 w-2 rounded-full ${isCurrent ? 'bg-accent' : scene.endedAt ? 'bg-text-muted' : 'border border-text-muted bg-bg-elevated'}`} />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {onOpenScene && !isCurrent
            ? <button onClick={() => onOpenScene(scene.id)} className="text-left text-sm font-medium text-text hover:text-accent focus-visible:text-accent">{label}</button>
            : <span className="text-sm font-medium text-text">{label}</span>}
          {location && <p className="truncate text-xs text-text-muted">{location}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${isCurrent ? 'bg-accent/15 text-accent' : 'bg-bg-sunken text-text-muted'}`}>{status}</span>
      </div>
      {recap
        ? <>
          <p id={recapId} className={`mt-2 whitespace-pre-wrap text-xs leading-relaxed text-text-muted ${expanded ? '' : 'line-clamp-2'}`}>{recap}</p>
          {recap.length > 110 && <button onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls={recapId}
            className="mt-1 text-xs text-accent hover:underline">{expanded ? 'Show less' : 'Show more'}</button>}
        </>
        : !scene.endedAt && <p className="mt-2 text-xs text-text-muted">No recap until this scene ends.</p>}
    </li>
  )
}
