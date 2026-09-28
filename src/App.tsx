import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/layout/Sidebar'
import type { ViewId } from '@/lib/ui/navigation'
import { CommandPalette } from '@/components/layout/CommandPalette'
import { KeyboardShortcutsSheet } from '@/components/layout/KeyboardShortcutsSheet'
import { ChatsPanel } from '@/components/chat/ChatsPanel'
import { ChatWindow } from '@/components/chat/ChatWindow'
import { GlobalBgm } from '@/components/chat/GlobalBgm'
import { WelcomeView } from '@/components/chat/WelcomeView'
import { AssistantView } from '@/components/assistant/AssistantView'
import { CastView } from '@/components/cast/CastView'
import { WorldsView } from '@/components/worlds/WorldsView'
import { WorldInfoView } from '@/components/worldinfo/WorldInfoView'
import { GalleryView } from '@/components/gallery/GalleryView'
import { SettingsView } from '@/components/settings/SettingsView'
import { ToastViewport } from '@/components/ui/ToastViewport'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { TutorialLauncher } from '@/components/help'
import { openHelp } from '@/lib/help/helpStore'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { chatsApi } from '@/lib/api/client'
import { useApplyTheme } from '@/lib/hooks/useApplyTheme'
import { useOutreachTick } from '@/lib/hooks/useOutreachTick'
import { useAutoContextLength } from '@/lib/hooks/useAutoContextLength'
import { useLegacyPlayerDefault } from '@/lib/hooks/useLegacyPlayerDefault'
import { useSettingsStore } from '@/lib/store/useSettingsStore'

/** The chat tab: the full-screen Welcome screen on a fresh install, otherwise the panel + window. */
function ChatSurface({
  activeChatId,
  onNavigate,
  onNavigateToWorld,
  playing,
  onPlay,
  onBack,
  onOpenMenu,
}: {
  activeChatId: string | null
  onNavigate: (view: ViewId) => void
  onNavigateToWorld: (worldId: string, tab?: string) => void
  playing: boolean
  onPlay: (id: string | null) => void
  onBack: () => void
  onOpenMenu: () => void
}) {
  const chats = useApiQuery('chats', () => chatsApi.list(), [])
  if (chats === undefined) return <div className="flex-1" />
  if (chats.length === 0) {
    return <WelcomeView onStarted={onPlay} onNavigate={onNavigate} />
  }

  if (!playing || !activeChatId) return <ChatsPanel activeChatId={activeChatId} onSelect={onPlay} />

  return <ChatWindow chatId={activeChatId} onBack={onBack} onOpenStudio={() => onNavigate('cast')} onOpenMenu={onOpenMenu}
    onOpenSettings={() => onNavigate('settings')} onNavigateToWorld={onNavigateToWorld} />
}

export default function App() {
  useApplyTheme()
  useOutreachTick()
  useAutoContextLength()
  useLegacyPlayerDefault()
  const [view, setView] = useState<ViewId>('stories')
  const [playing, setPlaying] = useState(false)
  const activeChatId = useSettingsStore((s) => s.activeChatId)
  const setActiveChatId = useSettingsStore((s) => s.setActiveChatId)
  const [showPalette, setShowPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  // Deep-link targets for the command palette's "jump to a character/world" — consumed (cleared)
  // by the view itself once it's actually opened that item's editor, not re-armed on every render.
  const [pendingCharacterId, setPendingCharacterId] = useState<string | null>(null)
  const [pendingCharacterTab, setPendingCharacterTab] = useState<string | null>(null)
  const [pendingWorldId, setPendingWorldId] = useState<string | null>(null)
  const [pendingWorldTab, setPendingWorldTab] = useState<string | null>(null)
  // Play keeps the menu. It opens on the compact rail each time a story starts (a per-session
  // width, so the saved Studio preference is untouched); on a phone the Menu button opens a drawer.
  const [playRailExpanded, setPlayRailExpanded] = useState(false)
  const [playMenuOpen, setPlayMenuOpen] = useState(false)
  // Stories from another view returns to whatever Stories showed (the open story, if any);
  // Stories while already there goes up to the library, like re-tapping a tab.
  const navigate = (next: ViewId) => {
    if (next === 'stories' && view === 'stories') setPlaying(false)
    setView(next)
  }
  const play = (id: string | null) => {
    setActiveChatId(id)
    setView('stories')
    setPlaying(Boolean(id))
    setPlayRailExpanded(false)
  }
  const backToStories = () => {
    setView('stories')
    setPlaying(false)
  }
  const openPlayMenu = () => {
    if (window.matchMedia('(min-width: 768px)').matches) setPlayRailExpanded((v) => !v)
    else setPlayMenuOpen(true)
  }
  const inPlay = view === 'stories' && playing && !!activeChatId
  // The Relationship panel's "Customize in World editor" link — same deep-link shape as the
  // command palette's `onSelectWorld` below, just also landing on a specific tab (e.g. 'dating'
  // for the gift/intimacy catalogs) instead of always the world's overview.
  const navigateToWorld = (worldId: string, tab?: string) => {
    setPendingWorldId(worldId)
    setPendingWorldTab(tab ?? null)
    setView('worlds')
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowPalette((v) => !v)
        return
      }
      // `?` is a real character people type constantly — only treat it as the shortcuts-sheet
      // shortcut when focus isn't in a text field, the same guard section 15's other new
      // shortcut (arrow-key swipe, in ChatWindow) uses.
      const target = e.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (e.key === '?' && !typing) {
        e.preventDefault()
        setShowShortcuts((v) => !v)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex h-full w-full flex-col md:flex-row">
      <Sidebar
        view={view}
        onChange={navigate}
        onOpenPalette={() => setShowPalette(true)}
        onOpenHelp={() => openHelp()}
        play={inPlay ? {
          expanded: playRailExpanded,
          onToggleExpanded: () => setPlayRailExpanded((v) => !v),
          mobileOpen: playMenuOpen,
          onCloseMobile: () => setPlayMenuOpen(false),
          onBackToStories: backToStories,
        } : undefined}
      />
      {/* The mobile bottom nav is `fixed`, out of normal flow — this padding keeps it from
          covering the last bit of content. No-op at `md` and up, where the rail is a sibling
          taking its own column width instead.
          `min-h-0` matters here: a flex item's default `min-height: auto` refuses to shrink
          below its content's natural height, so on a short mobile viewport a tall VN scene (a
          long reply plus a wrapped choice row) was measured growing this wrapper to 951px inside
          an 812px-tall parent — pushing the composer below the actual screen, unreachable, not
          just visually cramped. The same flexbox bug class already fixed once for the VN sprite
          itself; this is the wrapper one level up that the earlier mobile pass didn't happen to
          stress with tall-enough content to catch. */}
      <div className={`flex min-h-0 flex-1 min-w-0 ${inPlay ? '' : 'pb-14 md:pb-0'}`}>
        {view === 'stories' && (
          <ChatSurface activeChatId={activeChatId} onNavigate={navigate} onNavigateToWorld={navigateToWorld}
            playing={playing} onPlay={play} onBack={backToStories} onOpenMenu={openPlayMenu} />
        )}
        {view === 'writer' && <AssistantView />}
        {view === 'cast' && (
          <CastView initialCharacterId={pendingCharacterId} initialCharacterTab={pendingCharacterTab}
            onConsumedInitial={() => { setPendingCharacterId(null); setPendingCharacterTab(null) }} />
        )}
        {view === 'worlds' && (
          <WorldsView
            initialWorldId={pendingWorldId}
            initialTab={pendingWorldTab}
            onConsumedInitial={() => {
              setPendingWorldId(null)
              setPendingWorldTab(null)
            }}
          />
        )}
        {view === 'lore' && <WorldInfoView />}
        {view === 'media' && (
          <GalleryView
            onOpenWorld={navigateToWorld}
            onOpenCharacter={(id, tab) => {
              setPendingCharacterId(id)
              setPendingCharacterTab(tab ?? null)
              setView('cast')
            }}
          />
        )}
        {view === 'settings' && <SettingsView />}
      </div>
      {/* App-level so a world's music keeps playing across view switches. Mounted in every view:
          the one exclusion that used to exist was for a competing player in a view since removed. */}
      <GlobalBgm />
      <ToastViewport />
      {/* Help & tutorial, the guided tour, and the first-run offer (held back mid-story). */}
      <TutorialLauncher suppressPrompt={inPlay} />
      <ConfirmDialog />
      {showPalette && (
        <CommandPalette
          onClose={() => setShowPalette(false)}
          onNavigateView={navigate}
          onSelectChat={play}
          onSelectCharacter={(id) => {
            setPendingCharacterId(id)
            setView('cast')
          }}
          onSelectWorld={(id) => {
            setPendingWorldId(id)
            setView('worlds')
          }}
        />
      )}
      {showShortcuts && <KeyboardShortcutsSheet onClose={() => setShowShortcuts(false)} />}
    </div>
  )
}
