import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { newId } from '@/lib/id'
import type { PromptItem } from '@/lib/prompt/items'
import { Button } from '@/components/ui/Button'

export function PromptItemsEditor({ items, onChange }: { items: PromptItem[]; onChange: (items: PromptItem[]) => void }) {
  const update = (id: string, patch: Partial<PromptItem>) =>
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item))
  const move = (index: number, offset: number) => {
    const next = [...items]
    const destination = index + offset
    if (destination < 0 || destination >= next.length) return
    ;[next[index], next[destination]] = [next[destination], next[index]]
    onChange(next)
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">Items enter the prompt in this order. Disabled items and imported rules awaiting review stay out of generation. System items set context; User and Assistant items use native chat roles on hosted backends.</p>
      {items.map((item, index) => (
        <div key={item.id} className="rounded-xl border border-border bg-bg-sunken p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={`Name for prompt item ${index + 1}`}
              className="min-w-40 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text"
              value={item.name}
              onChange={(event) => update(item.id, { name: event.target.value })}
            />
            <select
              aria-label={`Role for ${item.name}`}
              className="rounded-lg border border-border bg-bg px-2 py-2 text-sm text-text"
              value={item.role}
              onChange={(event) => update(item.id, { role: event.target.value as PromptItem['role'] })}
            >
              <option value="system">System</option>
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
            </select>
            <label className="flex items-center gap-1 text-xs text-text-muted">
              <input type="checkbox" checked={item.enabled} disabled={!!item.importWarning} onChange={(event) => update(item.id, { enabled: event.target.checked })} />
              Enabled
            </label>
            <button type="button" aria-label={`Move ${item.name} up`} disabled={index === 0} onClick={() => move(index, -1)} className="p-2 text-text-muted hover:text-text disabled:opacity-30"><ArrowUp size={16} /></button>
            <button type="button" aria-label={`Move ${item.name} down`} disabled={index === items.length - 1} onClick={() => move(index, 1)} className="p-2 text-text-muted hover:text-text disabled:opacity-30"><ArrowDown size={16} /></button>
            <button type="button" aria-label={`Delete ${item.name}`} onClick={() => onChange(items.filter((entry) => entry.id !== item.id))} className="p-2 text-danger"><Trash2 size={16} /></button>
          </div>
          {item.importWarning && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-500">
              {item.importWarning}. Review the text and rewrite the rule for this app before enabling.
              <button type="button" className="ml-2 underline" onClick={() => update(item.id, { importWarning: undefined })}>Mark reviewed</button>
            </div>
          )}
          <textarea
            aria-label={`Content for ${item.name}`}
            rows={Math.min(12, Math.max(3, item.content.split('\n').length))}
            className="w-full rounded-lg border border-border bg-bg p-3 text-sm text-text"
            value={item.content}
            onChange={(event) => update(item.id, { content: event.target.value })}
          />
        </div>
      ))}
      <Button variant="secondary" onClick={() => onChange([...items, { id: newId(), name: 'New prompt item', content: '', role: 'system', enabled: true }])}>
        <Plus className="mr-1 h-4 w-4" /> Add prompt item
      </Button>
    </div>
  )
}
