import {
  BookOpen,
  GalleryHorizontalEnd,
  Globe,
  LibraryBig,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
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
}: {
  view: ViewId
  onChange: (v: ViewId) => void
  /** Opens the command palette (Ctrl/Cmd-K) — desktop-only trigger; the mobile bottom bar has no
   *  room to spare and a keyboard shortcut isn't the point on a touch device anyway. */
  onOpenPalette?: () => void
}) {
  const expanded = useSettingsStore((s) => s.sidebarExpanded)
  const setExpanded = useSettingsStore((s) => s.setSidebarExpanded)

  return (
    <nav
      // Below `md` there's no room for a vertical rail (expanded or not) alongside any of this
      // app's views, so it becomes a fixed bottom bar instead — icon-only, "expanded" is a
      // desktop-only concept there. At `md` and up this is the original vertical rail, unchanged.
      className={`fixed inset-x-0 bottom-0 z-30 flex items-center justify-around gap-0.5 border-t border-border bg-bg-elevated px-1 py-1.5
        md:static md:inset-auto md:z-auto md:flex-col md:justify-start md:gap-1 md:border-t-0 md:bg-gradient-to-b md:from-bg-elevated md:to-bg md:py-4 md:transition-[width] md:duration-200 ${
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
          onClick={() => onChange(item.id)}
          title={item.label}
          aria-label={item.label}
          aria-current={view === item.id ? 'page' : undefined}
          className={`flex min-w-0 flex-1 flex-col items-center justify-center rounded-xl text-[10px] transition-colors md:flex-initial md:flex-row ${
            expanded ? 'md:w-auto md:justify-start md:gap-3 md:px-3 md:py-2.5' : 'md:h-10 md:w-10'
          } h-11 ${
            view === item.id
              ? 'bg-accent/10 text-accent font-medium'
              : 'text-text-muted hover:bg-bg-sunken hover:text-text'
          }`}
        >
          <item.icon size={18} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate md:hidden">{item.label === "Writer's Room" ? 'Writer' : item.label}</span>
          {expanded && <span className="hidden md:inline">{item.label}</span>}
        </button>
        </div>
      ))}

      <button
        onClick={() => setExpanded(!expanded)}
        title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        className={`hidden items-center rounded-xl text-text-muted transition-colors hover:bg-bg-sunken hover:text-text md:mt-auto md:flex ${
          expanded ? 'md:justify-start md:gap-3 md:px-3 md:py-2.5' : 'md:h-10 md:w-10 md:justify-center'
        }`}
      >
        {expanded ? <PanelLeftClose size={18} strokeWidth={1.75} /> : <PanelLeftOpen size={18} strokeWidth={1.75} />}
      </button>
    </nav>
  )
}
