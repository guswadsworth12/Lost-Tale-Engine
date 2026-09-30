import { useMemo, useState } from 'react'
import { ArrowRight, Trash2 } from 'lucide-react'
import { chatsApi, momentsApi, storiesApi } from '@/lib/api/client'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chapterIdOf, chapterLabel, chaptersOf, sceneNumberInChapter } from '@/lib/story/chapters'
import { groupMoments, type StoryMoment } from '@/lib/story/moments'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import type { Chat, Story } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'

const KIND_LABEL: Record<StoryMoment['kind'], string> = { moment: 'Moment', background: 'Background', portrait: 'Portrait' }

/** How the Gallery names a scene and places it: chapter, number in the chapter, and title. */
export function sceneInfo(chat: Chat, allChats: readonly Chat[], stories: readonly Story[]) {
  const scenes = chat.storyId ? allChats.filter((c) => c.storyId === chat.storyId) : [chat]
  const chapters = chaptersOf(stories.find((s) => s.id === chat.storyId), scenes)
  const chapter = chapters.find((c) => c.id === chapterIdOf(chat)) ?? chapters[0]
  return {
    chapterId: chapter.id,
    chapterLabel: chapterLabel(chapter),
    chapterNumber: chapter.number,
    label: `Scene ${sceneNumberInChapter(chat)}${chat.sceneTitle ? ` · ${chat.sceneTitle}` : ''}`,
    order: chat.sceneNumber ?? 0,
  }
}

/**
 * The Gallery's story moments: every picture made with "Picture this", grouped Story → Chapter →
 * Scene, each with its caption (editable), a jump back to the moment, and delete.
 */
export function StoryMoments({ onOpenMoment }: { onOpenMoment?: (chatId: string, messageId?: string) => void }) {
  const moments = useApiQuery('moments', () => momentsApi.list(), []) ?? []
  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const stories = useApiQuery('stories', () => storiesApi.list(), []) ?? []
  const [viewing, setViewing] = useState<StoryMoment | null>(null)
  const groups = useMemo(() => groupMoments(moments, {
    story: (id) => stories.find((s) => s.id === id)?.title || chats.find((c) => c.id === id)?.title || 'A story',
    scene: (chatId) => {
      const chat = chats.find((c) => c.id === chatId)
      return chat ? sceneInfo(chat, chats, stories) : undefined
    },
  }), [moments, chats, stories])

  const rename = async (moment: StoryMoment, caption: string) => {
    if (caption.trim() === moment.caption) return
    try { await momentsApi.update(moment.id, { caption }) } catch (e) { toastError(errorMessage(e)) }
  }
  const remove = async (moment: StoryMoment) => {
    if (!await confirmDialog({ title: 'Delete this picture?', body: 'It is removed from the story gallery. A background or portrait it became stays where it is.', confirmLabel: 'Delete', tone: 'danger' })) return
    try { await momentsApi.remove(moment.id) } catch (e) { toastError(errorMessage(e)) }
  }

  if (!groups.length) {
    return <p className="mt-4 rounded-xl border border-dashed border-border p-6 text-sm text-text-muted">No story moments yet. In a scene, use Picture this (on a message, or in the scene's tools) to picture something that happened.</p>
  }
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section key={group.storyId} aria-label={group.storyTitle}>
          <h4 className="font-display text-base text-text">{group.storyTitle}</h4>
          {group.chapters.map((chapter) => (
            <div key={chapter.chapterId} className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted/70">{chapter.label}</p>
              {chapter.scenes.map((scene) => (
                <div key={scene.chatId} className="mt-2">
                  <p className="mb-2 text-xs text-text-muted">{scene.label}</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {scene.moments.map((moment) => (
                      <figure key={moment.id} className="overflow-hidden rounded-xl border border-border bg-bg-elevated">
                        <button type="button" onClick={() => setViewing(moment)} className="block w-full" aria-label={`View ${moment.caption || 'story moment'}`}>
                          <img src={moment.imageUrl} alt={moment.caption || 'Story moment'} className="aspect-[3/2] w-full object-cover" loading="lazy" />
                        </button>
                        <figcaption className="space-y-1.5 p-2">
                          <input aria-label="Caption" defaultValue={moment.caption} maxLength={200} placeholder={KIND_LABEL[moment.kind]}
                            onBlur={(e) => void rename(moment, e.target.value)}
                            className="w-full rounded-md bg-transparent px-1 py-0.5 text-xs text-text outline-none ring-1 ring-transparent focus:ring-accent/40" />
                          <div className="flex items-center justify-between gap-1 text-[11px] text-text-muted">
                            <span>{KIND_LABEL[moment.kind]}</span>
                            <span className="flex gap-1">
                              {onOpenMoment && (
                                <Button variant="ghost" className="inline-flex items-center gap-1 !px-1.5 !py-0.5 text-[11px]" onClick={() => onOpenMoment(moment.chatId, moment.messageId)}>
                                  Go to moment <ArrowRight size={11} />
                                </Button>
                              )}
                              <Button variant="ghost" className="!px-1.5 !py-0.5" aria-label="Delete picture" onClick={() => void remove(moment)}><Trash2 size={12} /></Button>
                            </span>
                          </div>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
      {viewing && (
        <Modal onClose={() => setViewing(null)} title={viewing.caption || KIND_LABEL[viewing.kind]} size="2xl">
          <img src={viewing.imageUrl} alt={viewing.caption || 'Story moment'} className="mx-auto max-h-[75vh] rounded-xl object-contain" />
          {viewing.prompt && <p className="mt-3 text-xs text-text-muted">{viewing.prompt}</p>}
        </Modal>
      )}
    </div>
  )
}
