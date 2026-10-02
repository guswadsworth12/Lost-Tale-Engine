import { Fragment, useEffect, useRef, type ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'

export interface EditorTab {
  id: string
  label: string
  /** Shown as a small count/dot next to the label — e.g. number of entries in a list tab. */
  badge?: number
  /** A heading the tab sits under in the side navigation and the phone picker. Tabs of a group should be adjacent. */
  group?: string
}

/** Adjacent tabs of the same group, in order. */
function groupTabs(tabs: EditorTab[]): { label?: string; tabs: EditorTab[] }[] {
  const groups: { label?: string; tabs: EditorTab[] }[] = []
  for (const tab of tabs) {
    const last = groups[groups.length - 1]
    if (last && last.label === tab.group) last.tabs.push(tab)
    else groups.push({ label: tab.group, tabs: [tab] })
  }
  return groups
}

const Badge = ({ tab, active }: { tab: EditorTab; active: boolean }) =>
  tab.badge !== undefined && tab.badge > 0 ? (
    <span className={`rounded-full px-1.5 text-[10px] ${active ? 'bg-accent/15 text-accent' : 'bg-bg-sunken text-text-muted'}`}>{tab.badge}</span>
  ) : null

/**
 * The shared frame for a full-page editor (world, character): a fixed header with a back button,
 * an eyebrow + title, and optional right-aligned actions; optional tabs; a scrolling content
 * column; and a sticky footer for the save/delete bar. Tabs are a side navigation on wide screens
 * (all of them always in view, under their group headings), a wrapping strip on medium ones, and a
 * picker on phones. Replaces the ad-hoc
 * "back button + mx-auto max-w-2xl + border-t footer" each editor rolled by hand.
 */
export function EditorShell({
  onBack,
  backLabel = 'Back',
  eyebrow,
  title,
  headerActions,
  tabs,
  activeTab,
  onTabChange,
  footer,
  children,
}: {
  onBack: () => void
  backLabel?: string
  eyebrow?: string
  title: string
  headerActions?: ReactNode
  tabs?: EditorTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  footer?: ReactNode
  children: ReactNode
}) {
  const hasTabs = !!tabs && tabs.length > 0
  const groups = hasTabs ? groupTabs(tabs) : []
  // With side navigation the page widens by the navigation's column, so header, content and footer stay aligned.
  const width = hasTabs ? 'max-w-3xl lg:max-w-[61rem]' : 'max-w-3xl'
  const scroller = useRef<HTMLDivElement>(null)
  // A new tab starts at its top, not wherever the last one was scrolled to.
  useEffect(() => { scroller.current?.scrollTo({ top: 0 }) }, [activeTab])

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border bg-bg-elevated">
        <div className={`mx-auto flex w-full ${width} items-center gap-3 px-4 py-3 sm:px-6`}>
          <button
            onClick={onBack}
            className="flex shrink-0 items-center gap-1 rounded-lg py-1 pr-2 text-sm text-text-muted transition-colors hover:text-text"
          >
            <ChevronLeft size={16} strokeWidth={2} />
            {backLabel}
          </button>
          <div className="min-w-0 flex-1">
            {eyebrow && (
              <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">{eyebrow}</div>
            )}
            <div className="truncate font-display text-base text-text">{title}</div>
          </div>
          {headerActions && <div className="flex shrink-0 items-center gap-2">{headerActions}</div>}
        </div>

        {hasTabs && (
          <div className={`mx-auto w-full ${width} px-4 sm:px-6 lg:hidden`}>
            {/* Phones: a native picker, grouped. */}
            <select
              aria-label="Section"
              value={activeTab}
              onChange={(e) => onTabChange?.(e.target.value)}
              className="mb-2 mt-1 w-full cursor-pointer rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:hidden"
            >
              {groups.map((group, index) => {
                const options = group.tabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                    {t.badge !== undefined && t.badge > 0 ? ` (${t.badge})` : ''}
                  </option>
                ))
                return group.label ? <optgroup key={group.label} label={group.label}>{options}</optgroup> : <Fragment key={index}>{options}</Fragment>
              })}
            </select>
            {/* Medium screens: every tab in view, wrapping onto a second line rather than scrolling off. */}
            <div className="hidden flex-wrap gap-x-1 sm:flex">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onTabChange?.(t.id)}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                    activeTab === t.id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text'
                  }`}
                >
                  {t.label}
                  <Badge tab={t} active={activeTab === t.id} />
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      <div ref={scroller} className="flex-1 overflow-y-auto">
        <div className={`mx-auto w-full ${width} px-4 py-6 sm:px-6 sm:py-8 ${hasTabs ? 'lg:grid lg:grid-cols-[11rem_minmax(0,1fr)] lg:gap-8' : ''}`}>
          {hasTabs && (
            <nav aria-label="Sections" className="hidden lg:block">
              <div className="sticky top-0 space-y-4">
                {groups.map((group, index) => (
                  <div key={group.label ?? index}>
                    {group.label && (
                      <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{group.label}</div>
                    )}
                    <div className="space-y-0.5">
                      {group.tabs.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => onTabChange?.(t.id)}
                          aria-current={activeTab === t.id ? 'page' : undefined}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-sm transition-colors ${
                            activeTab === t.id ? 'bg-accent/10 font-medium text-accent' : 'text-text-muted hover:bg-bg-sunken hover:text-text'
                          }`}
                        >
                          <span className="truncate">{t.label}</span>
                          <Badge tab={t} active={activeTab === t.id} />
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </nav>
          )}
          <div className="min-w-0">{children}</div>
        </div>
      </div>

      {footer && (
        <div className="shrink-0 border-t border-border bg-bg-elevated">
          <div className={`mx-auto flex w-full ${width} items-center justify-between gap-3 px-4 py-3 sm:px-6`}>{footer}</div>
        </div>
      )}
    </div>
  )
}
