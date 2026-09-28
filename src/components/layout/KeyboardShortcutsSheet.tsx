import { Modal } from '@/components/ui/Modal'
import { openHelp } from '@/lib/help/helpStore'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('mac')
const mod = isMac ? '⌘' : 'Ctrl'

const SHORTCUTS: { keys: string; description: string }[] = [
  { keys: `${mod} K`, description: 'Search everywhere: jump to a story, cast member, world, or section' },
  { keys: '← →', description: "Swipe to the previous/next reply, when the last message is the character's" },
  { keys: 'Esc', description: 'Close the open panel or dialog' },
  { keys: '?', description: 'Show this shortcuts sheet' },
  { keys: '← → Esc', description: 'In the guided tour: previous/next step, or skip it' },
]

/** Section 15's "discoverable keyboard shortcuts" — a `?` overlay listing what exists, since none of it was documented anywhere in the app before this. */
export function KeyboardShortcutsSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} title="Keyboard shortcuts" size="sm">
      <div className="space-y-2.5">
        {SHORTCUTS.map((s) => (
          <div key={s.keys} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-text-muted">{s.description}</span>
            <kbd className="shrink-0 rounded-md border border-border bg-bg-sunken px-2 py-1 font-mono text-xs text-text">
              {s.keys}
            </kbd>
          </div>
        ))}
        <button
          type="button"
          onClick={() => { onClose(); openHelp('shortcuts') }}
          className="pt-1 text-xs text-accent hover:underline"
        >
          More in Help &amp; tutorial
        </button>
      </div>
    </Modal>
  )
}
