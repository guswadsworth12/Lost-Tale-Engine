import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { TextAreaField } from '@/components/ui/Field'
import { ListEditor } from '@/components/ui/ListEditor'
import { Toggle } from '@/components/ui/Toggle'
import { SITUATIONS, EXAMPLE_BANK_MAX, EXAMPLE_TEXT_MAX, splitExamples, validateExampleBank, type ExampleBankEntry } from '@/lib/characters/exampleBank'
import { newId } from '@/lib/id'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { toastError } from '@/lib/store/useToastStore'

export function ExampleBankEditor({ entries, onChange, base, clearBase }: { entries: ExampleBankEntry[]; onChange: (entries: ExampleBankEntry[]) => void; base: string; clearBase: () => void }) {
  const update = (id: string, patch: Partial<ExampleBankEntry>) => onChange(entries.map((e) => e.id === id ? { ...e, ...patch } : e))
  const move = (at: number, direction: number) => {
    const next = [...entries]
    ;[next[at], next[at + direction]] = [next[at + direction], next[at]]
    onChange(next)
  }
  const split = async () => {
    try {
      const next = [...entries, ...splitExamples(base, newId)]
      validateExampleBank(next)
      if (next.length === entries.length) return
      onChange(next)
      if (await confirmDialog({ title: 'Clear the original example messages?', body: 'The split copies are now in the bank. Keep the originals to send them every turn, or clear them to use only the chosen bank examples when Deep Memory is on.', confirmLabel: 'Clear originals', cancelLabel: 'Keep originals' })) clearBase()
    } catch (error) { toastError((error as Error).message) }
  }
  return <div className="min-w-0 space-y-3">
    <h3 className="text-sm font-semibold">Example bank</h3>
    <p className="text-xs text-text-muted">Used when Deep Memory is on in this character’s world. Each example is one exchange starting with &lt;START&gt;, with {'{{user}}:'} and {'{{char}}:'} lines. Choose the situations it suits; up to two fitting examples join the base examples each reply.</p>
    <Button variant="ghost" disabled={!base.trim()} onClick={() => void split()}>Split my current examples into the bank</Button>
    <ListEditor items={entries} getKey={(e) => e.id} onRemove={(entry) => onChange(entries.filter((e) => e.id !== entry.id))}
      addLabel="Add an example" emptyHint="Add exchanges that show different sides of their voice."
      onAdd={() => { if (entries.length >= EXAMPLE_BANK_MAX) { toastError('The bank holds up to 40 examples.'); return }; onChange([...entries, { id: newId(), text: '<START>\n{{user}}: \n{{char}}: ', situations: ['everyday'], enabled: true }]) }}
      renderItem={(entry, at) => <div className="min-w-0 space-y-2">
        <Toggle checked={entry.enabled} onChange={(enabled) => update(entry.id, { enabled })} label={`Use example ${at + 1}`} />
        <TextAreaField label={`Example ${at + 1}`} rows={6} maxLength={EXAMPLE_TEXT_MAX} value={entry.text} onChange={(event) => update(entry.id, { text: event.target.value })} hint={`${entry.text.length} / 3,000 characters`} />
        <div className="flex flex-wrap gap-1.5" aria-label={`Situations for example ${at + 1}`}>{SITUATIONS.map((situation) => <Chip key={situation} on={entry.situations.includes(situation)} onClick={() => update(entry.id, { situations: entry.situations.includes(situation) ? entry.situations.filter((s) => s !== situation) : [...entry.situations, situation] })}>{situation}</Chip>)}</div>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" disabled={at === 0} onClick={() => move(at, -1)}>Move up</Button><Button variant="ghost" disabled={at === entries.length - 1} onClick={() => move(at, 1)}>Move down</Button></div>
      </div>} />
    <p className="text-xs text-text-muted">{entries.length} / 40 examples. Order breaks ties. Turning one off keeps its text for later.</p>
  </div>
}
