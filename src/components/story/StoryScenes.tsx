import { useId, useState } from 'react'
import { GitBranch } from 'lucide-react'
import type { Chat, Story } from '@/lib/types'
import { sceneLabel } from '@/lib/story/recaps'
import { sceneLocation, storyLanes } from '@/lib/story/library'
import { StorySequelLink } from './StorySequelLink'

/**
 * A story's timeline: its scenes, one lane per storyline (the main line first), each scene with
 * where it happened, whether it's over, and its recap. Opening a scene hands its chat id back.
 * `showSequelLink` adds the story's "Continues from" setting underneath.
 */
export function StoryScenes({ story, scenes, currentSceneId, onOpenScene, showSequelLink = false }: {
  story?: Story
  scenes: Chat[]
  currentSceneId?: string
  onOpenScene?: (chatId: string) => void
  showSequelLink?: boolean
}) {
  const lanes = storyLanes(story, scenes)
  const sequelLink = showSequelLink && story
    // Keyed on the saved link so the form resets when it changes underneath (another window, a refetch).
    ? <StorySequelLink key={`${story.id}:${story.continuesFrom?.storyId ?? ''}:${story.continuesFrom?.sceneId ?? ''}`} story={story} />
    : null
  if (!lanes.length) {
    const empty = <p className="text-xs text-text-muted">No scenes yet.</p>
    return sequelLink ? <div className="space-y-5">{empty}{sequelLink}</div> : empty
  }
  const multiLane = lanes.length > 1
  return (
    <div className="space-y-5">
      {lanes.map((lane) => (
        <Lane key={lane.storylineId} name={multiLane ? lane.name : undefined}
          splitFrom={lane.splitFrom} scenes={lane.scenes} currentSceneId={currentSceneId} onOpenScene={onOpenScene} />
      ))}
      {sequelLink}
    </div>
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
