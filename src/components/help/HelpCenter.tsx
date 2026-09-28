import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  Clock,
  Compass,
  Dices,
  Drama,
  GalleryHorizontalEnd,
  Globe,
  Heart,
  Keyboard,
  LibraryBig,
  Menu,
  MessageSquareText,
  PanelRight,
  Route,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import {
  DEFAULT_HELP_TOPIC,
  HELP_GROUPS,
  HELP_TOPICS,
  getHelpTopic,
  searchHelp,
  type HelpBlock,
  type HelpIconName,
  type HelpTopicId,
} from '@/lib/help/helpContent'
import { HelpText } from './HelpText'

const ICONS: Record<HelpIconName, LucideIcon> = {
  compass: Compass,
  menu: Menu,
  library: LibraryBig,
  message: MessageSquareText,
  drama: Drama,
  panel: PanelRight,
  users: Users,
  globe: Globe,
  book: BookOpen,
  gallery: GalleryHorizontalEnd,
  sparkles: Sparkles,
  settings: SettingsIcon,
  dice: Dices,
  clock: Clock,
  heart: Heart,
  keyboard: Keyboard,
}

export interface HelpCenterProps {
  open: boolean
  onClose: () => void
  /** Opens straight to this topic (e.g. 'visual-novel' from a VN control). Defaults to Getting started. */
  initialTopic?: HelpTopicId
  /** Shows a "Take the tour" button in the header. */
  onStartTour?: () => void
}

/**
 * "Help & tutorial": the organized, searchable reference. Topics are grouped down the side (a
 * drop-down on phones); the search box filters every section of every topic.
 */
export function HelpCenter({ open, onClose, initialTopic, onStartTour }: HelpCenterProps) {
  if (!open) return null
  // Keyed so a new deep link while open (or a reopen) starts from that topic.
  return <HelpCenterDialog key={initialTopic ?? DEFAULT_HELP_TOPIC} onClose={onClose} initialTopic={initialTopic} onStartTour={onStartTour} />
}

function HelpCenterDialog({ onClose, initialTopic, onStartTour }: Omit<HelpCenterProps, 'open'>) {
  const [topicId, setTopicId] = useState<HelpTopicId>(getHelpTopic(initialTopic).id)
  const [query, setQuery] = useState('')
  const [pendingSection, setPendingSection] = useState<string | null>(null)
  const articleRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchId = useId()
  const topicSelectId = useId()
  const titleId = useId()
  const topic = getHelpTopic(topicId)
  const results = useMemo(() => searchHelp(query), [query])
  const searching = query.trim().length > 0

  // Topic switch (or a search result): start at the top, or at the chosen section.
  useEffect(() => {
    if (searching) return
    const article = articleRef.current
    if (!article) return
    if (pendingSection) {
      const target = article.querySelector<HTMLElement>(`[data-help-section="${pendingSection}"]`)
      if (target) {
        article.scrollTop = Math.max(0, target.offsetTop - 8)
        target.focus({ preventScroll: true })
      }
      setPendingSection(null)
    } else {
      article.scrollTop = 0
    }
  }, [topicId, pendingSection, searching])

  // Modal focuses its first control (the Tour button); start in the search box instead. Not on a
  // phone, where focusing a text field throws the keyboard over the content: the topic gets focus.
  useEffect(() => {
    const phone = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639px)').matches
    if (phone) articleRef.current?.focus({ preventScroll: true })
    else searchRef.current?.focus({ preventScroll: true })
  }, [])

  const goTo = (id: HelpTopicId, sectionId?: string) => {
    setTopicId(id)
    setQuery('')
    setPendingSection(sectionId ?? null)
  }

  const tourButton = onStartTour ? (
    <Button variant="secondary" onClick={onStartTour} aria-label="Take the tour" className="inline-flex items-center gap-1.5">
      <Route size={14} strokeWidth={2} />
      <span className="sm:hidden">Tour</span>
      <span className="hidden sm:inline">Take the tour</span>
    </Button>
  ) : undefined

  return (
    <Modal onClose={onClose} title="Help & tutorial" size="3xl" scrollable compact headerExtra={tourButton}>
      <div className="flex h-[74vh] min-h-0 flex-col gap-3 sm:h-[68vh]">
        <div className="relative shrink-0">
          <Search size={15} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <label htmlFor={searchId} className="sr-only">
            Search help
          </label>
          <input
            ref={searchRef}
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search help…"
            className="w-full rounded-xl bg-bg-sunken py-2.5 pl-9 pr-3 text-base text-text outline-none ring-1 ring-transparent transition-shadow placeholder:text-text-muted/60 focus:ring-accent/40 sm:py-2 sm:text-sm"
          />
        </div>

        {/* Phones: one drop-down instead of a side list, so nothing scrolls sideways at 375px. */}
        {!searching && (
          <div className="shrink-0 sm:hidden">
            <label htmlFor={topicSelectId} className="sr-only">
              Help topic
            </label>
            <select
              id={topicSelectId}
              value={topic.id}
              onChange={(event) => goTo(getHelpTopic(event.target.value).id)}
              className="w-full cursor-pointer rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40"
            >
              {HELP_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {HELP_TOPICS.filter((entry) => entry.group === group).map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 gap-5">
          <nav aria-label="Help topics" className="hidden w-52 shrink-0 overflow-y-auto pr-1 sm:block">
            {HELP_GROUPS.map((group) => (
              <div key={group} className="mb-3">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">{group}</div>
                <ul className="space-y-0.5">
                  {HELP_TOPICS.filter((entry) => entry.group === group).map((entry) => {
                    const Icon = ICONS[entry.icon]
                    const active = !searching && entry.id === topic.id
                    return (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => goTo(entry.id)}
                          aria-current={active ? 'page' : undefined}
                          className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                            active ? 'bg-accent/10 font-medium text-accent' : 'text-text-muted hover:bg-bg-sunken hover:text-text'
                          }`}
                        >
                          <Icon size={15} strokeWidth={1.75} className="shrink-0" />
                          <span className="min-w-0 truncate">{entry.title}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {searching ? (
            <section aria-label="Search results" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
              <p className="mb-2 text-xs text-text-muted" aria-live="polite">
                {results.length === 0 ? `Nothing matches "${query.trim()}".` : `${results.length} ${results.length === 1 ? 'match' : 'matches'}`}
              </p>
              <ul className="space-y-1.5">
                {results.map((result) => (
                  <li key={`${result.topicId}-${result.sectionId ?? 'topic'}`}>
                    <button
                      type="button"
                      onClick={() => goTo(result.topicId, result.sectionId)}
                      className="w-full rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:border-accent/40 hover:bg-accent/5"
                    >
                      <span className="block text-[11px] uppercase tracking-wide text-text-muted">{result.topicTitle}</span>
                      <span className="block text-sm font-medium text-text">{result.heading}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{result.snippet}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <article
              ref={articleRef}
              aria-labelledby={titleId}
              tabIndex={0}
              className="relative min-h-0 min-w-0 flex-1 overflow-y-auto rounded-lg pr-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/40"
            >
              <header className="mb-4">
                <h3 id={titleId} className="font-display text-lg text-text">
                  {topic.title}
                </h3>
                <p className="mt-1 text-sm text-text-muted">{topic.summary}</p>
                {topic.condition && (
                  <p className="mt-2 inline-flex rounded-full bg-accent/10 px-2.5 py-1 text-xs text-accent">{topic.condition}</p>
                )}
              </header>

              <div className="space-y-6">
                {topic.sections.map((section) => (
                  <section key={section.id} data-help-section={section.id} tabIndex={-1} className="outline-none" aria-labelledby={`help-${section.id}`}>
                    <h4 id={`help-${section.id}`} className="mb-2 text-sm font-semibold text-text">
                      {section.heading}
                    </h4>
                    <div className="space-y-2.5 text-sm leading-relaxed text-text-muted">
                      {section.blocks.map((block, i) => (
                        <HelpBlockView key={i} block={block} />
                      ))}
                    </div>
                  </section>
                ))}
              </div>

              {!!topic.related?.length && (
                <footer className="mt-8 border-t border-border pt-4">
                  <div className="mb-2 text-xs font-medium text-text-muted">Related</div>
                  <div className="flex flex-wrap gap-2">
                    {topic.related.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => goTo(id)}
                        className="rounded-lg bg-bg-sunken px-2.5 py-1 text-xs text-text-muted transition-colors hover:text-text"
                      >
                        {getHelpTopic(id).title}
                      </button>
                    ))}
                  </div>
                </footer>
              )}
            </article>
          )}
        </div>
      </div>
    </Modal>
  )
}

function HelpBlockView({ block }: { block: HelpBlock }) {
  switch (block.kind) {
    case 'text':
      return (
        <p>
          <HelpText text={block.text} />
        </p>
      )
    case 'note':
      return (
        <p className="rounded-lg border-l-2 border-accent/60 bg-bg-sunken px-3 py-2 text-xs leading-relaxed">
          <HelpText text={block.text} />
        </p>
      )
    case 'list':
      return (
        <ul className="list-disc space-y-1.5 pl-5 marker:text-text-muted/60">
          {block.items.map((item, i) => (
            <li key={i}>
              <HelpText text={item} />
            </li>
          ))}
        </ul>
      )
    case 'steps':
      return (
        <ol className="list-decimal space-y-1.5 pl-5 marker:text-text-muted">
          {block.items.map((item, i) => (
            <li key={i}>
              <HelpText text={item} />
            </li>
          ))}
        </ol>
      )
    case 'keys':
      return (
        <ul className="space-y-2">
          {block.rows.map((row) => (
            <li key={row.keys + row.description} className="flex items-start justify-between gap-4">
              <span className="min-w-0 text-sm text-text-muted">{row.description}</span>
              <kbd className="shrink-0 whitespace-nowrap rounded-md border border-border bg-bg-sunken px-2 py-1 font-mono text-xs text-text">{row.keys}</kbd>
            </li>
          ))}
        </ul>
      )
  }
}
