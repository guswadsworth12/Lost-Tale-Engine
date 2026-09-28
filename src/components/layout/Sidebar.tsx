import { useEffect, useRef } from 'react'
import {
  ArrowLeft,
  BookOpen,
  CircleHelp,
  GalleryHorizontalEnd,
  Globe,
  LibraryBig,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useFocusTrap } from '@/lib/hooks/useFocusTrap'
import { BrandMark, BrandWordmark } from '@/components/ui/BrandMark'
import { USER_LABELS, type ViewId } from '@/lib/ui/navigation'

export type { ViewId } from '@/lib/ui/navigation'

export const NAV: { id: ViewId; label: string; section: 'Play' | 'Studio' | 'Tools'; icon: LucideIcon }[] = [
  { id: 'stories', label: 'Stories', section: 'Play', icon: LibraryBig },
  { id: 'cast', label: USER_LABELS.Characters, section: 'Studio', icon: Users },
  { id: 'worlds', label: 'Worlds', section: 'Studio', icon: Globe },
  { id: 'lore', label: USER_LABELS['World Info'], section: 'Studio', icon: BookOpen },
  { id: 'media', label: USER_LABELS.Gallery, section: 'Studio', icon: GalleryHorizontalEnd },
  { id: 'writer', label: USER_LABELS.Assistant, section: 'Tools', icon: Sparkles },
  { id: 'settings', label: 'Settings', section: 'Tools', icon: SettingsIcon },
]

export function Sidebar({
  view,
  onChange,
  onOpenPalette,
  onOpenHelp,
  play,
}: {
  view: ViewId
  onChange: (v: ViewId) => void
  /** Opens the command palette (Ctrl/Cmd-K) — desktop-only trigger; the mobile bottom bar has no
   *  room to spare and a keyboard shortcut isn't the point on a touch device anyway. */
  onOpenPalette?: () => void
  onOpenHelp?: () => void
  /**
   * Set while a story is on screen. The rail stays (navigation never disappears mid-story), but its
   * width follows a per-session state that starts collapsed instead of the saved preference, so
   * entering a story always opens on the compact rail without overwriting that preference. On a
   * phone the bottom bar would sit on the composer, so it hides and `mobileOpen` shows a drawer.
   */
  play?: {
    expanded: boolean
    onToggleExpanded: () => void
    mobileOpen: boolean
    onCloseMobile: () => void
    onBackToStories: () => void
  }
}) {
  const savedExpanded = useSettingsStore((s) => s.sidebarExpanded)
  const setSavedExpanded = useSettingsStore((s) => s.setSidebarExpanded)
  const expanded = play ? play.expanded : savedExpanded
  const toggleExpanded = play ? play.onToggleExpanded : () => setSavedExpanded(!savedExpanded)

  return (
    <>
    <nav
      data-tour="nav"
      aria-label="Main"
      // Below `md` there's no room for a vertical rail (expanded or not) alongside any of this
      // app's views, so it becomes a fixed bottom bar instead — icon-only, "expanded" is a
      // desktop-only concept there. At `md` and up this is the original vertical rail, unchanged.
      className={`fixed inset-x-0 bottom-0 z-30 items-center justify-around gap-0.5 border-t border-border bg-bg-elevated px-1 py-1.5
        md:static md:inset-auto md:z-auto md:flex md:flex-col md:justify-start md:gap-1 md:border-t-0 md:bg-gradient-to-b md:from-bg-elevated md:to-bg md:py-4 md:transition-[width] md:duration-200 ${
        play ? 'hidden' : 'flex'
      } ${
        expanded ? 'md:w-40 md:px-2' : 'md:w-14 md:items-center md:px-1.5'
      }`}
    >
      <div
        className={`mb-3 hidden md:flex ${expanded ? 'md:px-2 md:pt-1' : 'md:justify-center'}`}
        title="Lost Tales Engine"
        aria-label="Lost Tales Engine"
      >
        {expanded ? <BrandWordmark size={24} /> : <BrandMark size={26} className="text-accent" />}
      </div>
      {onOpenPalette && (
        <button
          onClick={onOpenPalette}
          title="Search everywhere (Ctrl/Cmd-K)"
          aria-label="Search everywhere"
          className={`mb-1 hidden items-center rounded-xl text-text-muted transition-colors hover:bg-bg-sunken hover:text-text md:flex ${
            expanded ? 'md:justify-start md:gap-3 md:px-3 md:py-2.5' : 'md:h-10 md:w-10 md:justify-center'
          }`}
        >
          <Search size={18} strokeWidth={1.75} className="shrink-0" />
          {expanded && <span className="hidden md:inline">Search</span>}
        </button>
      )}
      {NAV.map((item, index) => (
        <div key={item.id} className="contents md:block md:w-full">
        {(index === 0 || NAV[index - 1].section !== item.section) && (
          <div className={`hidden px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted md:block ${index > 0 ? 'md:pt-4' : ''}`}>
            {expanded ? item.section : <span className="sr-only">{item.section}</span>}
          </div>
        )}
        <button
          data-tour={`nav-${item.id}`}
          onClick={() => onChange(item.id)}
          title={item.label}
          aria-label={item.label}
          aria-current={view === item.id ? 'page' : undefined}
          className={`flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl text-[10px] transition-colors md:flex-initial md:flex-row md:text-sm ${
            expanded ? 'md:w-auto md:justify-start md:gap-3 md:px-3 md:py-2.5' : 'md:h-10 md:w-10'
          } h-11 ${
            view === item.id
              ? 'bg-accent/10 text-accent font-medium'
              : 'text-text-muted hover:bg-bg-sunken hover:text-text'
          }`}
        >
          <item.icon size={18} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate md:hidden">{item.label === "Writer's Room" ? 'Writer' : item.label}</span>
          {expanded && <span className="hidden truncate md:inline">{item.label}</span>}
        </button>
        </div>
      ))}

      {onOpenHelp && (
        <button
          data-tour="nav-help"
          onClick={onOpenHelp}
          title="Help & tutorial"
          aria-label="Help & tutorial"
          className={`hidden items-center rounded-xl text-text-muted transition-colors hover:bg-bg-sunken hover:text-text md:mt-auto md:flex ${
            expanded ? 'md:justify-start md:gap-3 md:px-3 md:py-2.5' : 'md:h-10 md:w-10 md:justify-center'
          }`}
        >
          <CircleHelp size={18} strokeWidth={1.75} className="shrink-0" />
          {expanded && <span>Help</span>}
        </button>
      )}
      <button
        onClick={toggleExpanded}
        title={expanded ? 'Collapse menu' : 'Expand menu'}
        aria-label={expanded ? 'Collapse menu' : 'Expand menu'}
        aria-expanded={expanded}
        className={`hidden items-center rounded-xl text-text-muted transition-colors hover:bg-bg-sunken hover:text-text md:flex ${onOpenHelp ? '' : 'md:mt-auto'} ${
          expanded ? 'md:justify-start md:gap-3 md:px-3 md:py-2.5' : 'md:h-10 md:w-10 md:justify-center'
        }`}
      >
        {expanded ? <PanelLeftClose size={18} strokeWidth={1.75} /> : <PanelLeftOpen size={18} strokeWidth={1.75} />}
        {expanded && <span>Collapse</span>}
      </button>
    </nav>
    {play?.mobileOpen && (
      <MobileNavDrawer
        view={view}
        onChange={onChange}
        onOpenHelp={onOpenHelp}
        onClose={play.onCloseMobile}
        onBackToStories={play.onBackToStories}
      />
    )}
    </>
  )
}

/** The phone menu while a story is open: opened from the play header's Menu button, closed by
 *  choosing a destination, the close button, the backdrop, or Escape. */
function MobileNavDrawer({
  view,
  onChange,
  onOpenHelp,
  onClose,
  onBackToStories,
}: {
  view: ViewId
  onChange: (v: ViewId) => void
  onOpenHelp?: () => void
  onClose: () => void
  onBackToStories: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useFocusTrap(panelRef, true)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])
  const go = (next: () => void) => {
    onClose()
    next()
  }
  const sections = ['Play', 'Studio', 'Tools'] as const

  return (
    <div className="animate-overlay-in fixed inset-0 z-50 bg-black/40 md:hidden" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onClick={(e) => e.stopPropagation()}
        className="animate-panel-in absolute inset-y-0 left-0 flex w-[min(18rem,85vw)] flex-col gap-1 overflow-y-auto border-r border-border bg-bg-elevated p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-2xl"
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <BrandWordmark size={22} />
          <button
            onClick={onClose}
            aria-label="Close menu"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-text-muted hover:bg-bg-sunken hover:text-text"
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <button
          onClick={() => go(onBackToStories)}
          className="flex h-11 items-center gap-3 rounded-xl bg-accent/10 px-3 text-sm font-medium text-accent"
        >
          <ArrowLeft size={18} strokeWidth={1.75} /> Back to Stories
        </button>
        {sections.map((section) => (
          <div key={section} className="mt-2">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">{section}</div>
            {NAV.filter((item) => item.section === section).map((item) => (
              <button
                key={item.id}
                // "Current story" is where the drawer was opened from, so it only closes the drawer.
                onClick={() => go(() => item.id !== 'stories' && onChange(item.id))}
                aria-current={view === item.id ? 'page' : undefined}
                className={`flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors ${
                  view === item.id ? 'text-accent' : 'text-text-muted hover:bg-bg-sunken hover:text-text'
                }`}
              >
                <item.icon size={18} strokeWidth={1.75} className="shrink-0" />
                {item.id === 'stories' ? 'Current story' : item.label}
              </button>
            ))}
          </div>
        ))}
        {onOpenHelp && (
          <button
            onClick={() => go(onOpenHelp)}
            className="mt-auto flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm text-text-muted hover:bg-bg-sunken hover:text-text"
          >
            <CircleHelp size={18} strokeWidth={1.75} className="shrink-0" /> Help &amp; tutorial
          </button>
        )}
      </div>
    </div>
  )
}
