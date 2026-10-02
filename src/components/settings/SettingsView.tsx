import { useEffect, useState } from 'react'
import { SetupChecklist } from '@/components/setup/SetupChecklist'
import { Section } from '@/components/ui/Section'
import type { ViewId } from '@/components/layout/Sidebar'
import { CircleHelp } from 'lucide-react'
import { TutorialSettingsSection } from '@/components/help'
import { openHelp } from '@/lib/help/helpStore'
import { ModelsAndServicesSettings } from './ModelsAndServicesSettings'
import { ThemeEditor } from './ThemeEditor'
import { SamplingControls } from './SamplingControls'
import { VoiceSettings } from './VoiceSettings'
import { ImageGenSettings } from './ImageGenSettings'
import { DataSettings } from './DataSettings'
import { AccountSettings } from './AccountSettings'
import { AdminSettings } from './AdminSettings'
import { useAuthStore } from '@/lib/accounts/useAuthStore'
import { AccountMenu } from '@/components/layout/AccountMenu'

export type SettingsTab = 'setup' | 'models' | 'appearance' | 'generation' | 'voice' | 'images' | 'data' | 'account' | 'admin'

type Tab = SettingsTab

export function SettingsView({ onStarted, onNavigate, requestedTab, onConsumedTab }: {
  onStarted: (chatId: string) => void
  onNavigate: (view: ViewId) => void
  /** A tab to open on, e.g. Account from the account menu; cleared through `onConsumedTab` once shown. */
  requestedTab?: SettingsTab | null
  onConsumedTab?: () => void
}) {
  const [tab, setTab] = useState<Tab>(requestedTab ?? 'models')
  const isOwner = useAuthStore((s) => s.user?.role === 'owner')
  useEffect(() => {
    if (!requestedTab) return
    setTab(requestedTab)
    onConsumedTab?.()
  }, [requestedTab, onConsumedTab])

  const TABS: [Tab, string][] = [
    ['setup', 'Get set up'],
    ['models', 'Models and services'],
    ['appearance', 'Appearance'],
    ['generation', 'Generation'],
    ['voice', 'Voice'],
    ['images', 'Images'],
    ['data', 'Data'],
    ['account', 'Account'],
    ...(isOwner ? [['admin', 'Admin'] as [Tab, string]] : []),
  ]

  return (
    // No top padding on the scroll container itself — `sticky top-0` sticks relative to the
    // container's padding edge, so any `pt` here would leave a gap above the pinned strip that
    // scrolled content shows through. The top gap lives on the (non-sticky) heading instead.
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-10 sm:px-8">
      <div className="flex items-center justify-between gap-3 pb-4 pt-4 sm:pt-8">
        <h2 className="font-display text-lg text-text">Settings</h2>
        {/* Help's only door on a phone outside a story, where the bottom bar has no room for it. */}
        <button
          type="button"
          onClick={() => openHelp()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-sunken hover:text-text"
        >
          <CircleHelp size={14} strokeWidth={1.75} />
          Help &amp; tutorial
        </button>
        {/* The account menu's phone door: wider screens have it in the top-right corner. */}
        <AccountMenu className="md:hidden" onOpen={setTab} />
      </div>
      {/* Only the tab strip sticks — the heading scrolls away. `bg-bg` + the `pb` shelf keep it
          opaque top-to-bottom so switching tabs from deep in a long tab (Generation is ~16
          sections) never means scrolling back up. */}
      <div className="sticky top-0 z-20 bg-bg pb-3 pt-1.5 sm:pb-4 sm:pt-2">
        {/* Mobile: a native select instead of a strip that scrolls tabs off-screen (Voice and Data
            were previously unreachable without this). Desktop keeps the visible strip. */}
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value as Tab)}
          className="w-full cursor-pointer rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:hidden"
        >
          {TABS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
        <div className="hidden gap-1 overflow-x-auto border-b border-border sm:flex">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              // Opened from elsewhere (the account menu's Admin), the chosen tab may sit past the strip's edge.
              ref={tab === id ? (el) => el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }) : undefined}
              className={`shrink-0 border-b-2 px-3 py-2.5 text-sm transition-colors ${
                tab === id ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="pt-6">
        {tab === 'setup' && (
          <Section title="Get set up" description="Each step ticks itself once it's done. Reopen any of them here." surface="bare">
            <SetupChecklist onStarted={onStarted} onNavigate={onNavigate} />
          </Section>
        )}
        {tab === 'models' && <ModelsAndServicesSettings />}
        {tab === 'appearance' && <ThemeEditor />}
        {tab === 'generation' && <SamplingControls />}
        {tab === 'voice' && <VoiceSettings />}
        {tab === 'images' && <ImageGenSettings />}
        {tab === 'data' && <><DataSettings /><div className="mt-8"><TutorialSettingsSection /></div></>}
        {tab === 'account' && <AccountSettings />}
        {tab === 'admin' && <AdminSettings />}
      </div>
    </div>
  )
}
