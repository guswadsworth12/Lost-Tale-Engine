import { useMemo, useState } from 'react'
import { BookOpen, Pin } from 'lucide-react'
import type { Character } from '@/lib/characters/cardSpec'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, chatsApi, memoriesApi, type CharacterMemoryListing } from '@/lib/api/client'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { Section } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { SelectField, TextAreaField } from '@/components/ui/Field'
import {
  MEMORY_KIND_LABELS,
  chatOptionLabel,
  chatsWithCharacter,
  countRetired,
  groupMemories,
  otherKnowers,
  tellCandidates,
} from './memoriesView'

const actionClass = 'rounded-md px-2 py-1 text-[11px] text-text-muted transition-colors hover:bg-bg-sunken hover:text-text disabled:opacity-40'
const badgeClass = 'rounded-full px-1.5 py-px text-[10px] font-medium'
const selectClass = 'rounded-lg bg-bg-sunken px-2 py-1 text-xs text-text outline-none ring-1 ring-transparent focus:ring-accent/40'

/**
 * Everything a saved character remembers (`memoriesApi.forCharacter`), grouped by story and scene,
 * with the player's corrections: edit, pin, resolve, tell someone else, forget. Memories are written
 * by the scribe during play; the form at the bottom adds one by hand.
 */
export function MemoriesPanel({ character }: { character: Character }) {
  const rows = useApiQuery('memories', () => memoriesApi.forCharacter(character.id), [character.id])
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const [showRetired, setShowRetired] = useState(false)

  const names = useMemo(() => new Map(characters.map((c) => [c.id, c.card.name])), [characters])
  const nameOf = (id: string) => names.get(id)
  const groups = useMemo(() => groupMemories(rows ?? [], { showRetired }), [rows, showRetired])
  const retired = rows ? countRetired(rows) : 0
  const scenes = useMemo(() => chatsWithCharacter(chats, character.id), [chats, character.id])
  const name = character.card.name || 'This character'

  return (
    <div className="space-y-10">
      <Section
        title="Memories"
        description={`What ${name} saw, heard, or was told. Each memory stays in the story it happened in.`}
        action={retired > 0 ? <Chip on={showRetired} onClick={() => setShowRetired((v) => !v)}>Show retired · {retired}</Chip> : undefined}
        surface="bare"
      >
        {!rows ? (
          <p className="text-sm text-text-muted">Loading memories…</p>
        ) : groups.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-text-muted">
            {retired > 0
              ? 'Only retired memories here. Turn on Show retired to see them.'
              : 'Nothing yet. Memories are recorded automatically during play (Settings → Generation → Character memory), and only in the story they happened in.'}
          </p>
        ) : (
          <div className="space-y-8">
            {groups.map((story) => (
              <section key={story.key || 'unsorted'} aria-label={story.title} className="space-y-3">
                <h4 className="font-display text-sm font-semibold text-text">{story.title}</h4>
                {story.journals.map((journal) => (
                  <MemoryCard key={journal.id} memory={journal} character={character} characters={characters} nameOf={nameOf} journal />
                ))}
                {story.scenes.map((scene) => (
                  <div key={scene.chatId} className="space-y-2">
                    <h5 className="text-xs font-medium uppercase tracking-wider text-text-muted">{scene.label}</h5>
                    <ul className="space-y-2">
                      {scene.memories.map((memory) => (
                        <li key={memory.id}>
                          <MemoryCard memory={memory} character={character} characters={characters} nameOf={nameOf} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </section>
            ))}
          </div>
        )}
      </Section>
      {scenes.length > 0 && <AddMemoryForm character={character} scenes={scenes} />}
    </div>
  )
}

function MemoryCard({ memory, character, characters, nameOf, journal = false }: {
  memory: CharacterMemoryListing
  character: Character
  characters: Character[]
  nameOf: (id: string) => string | undefined
  journal?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(memory.text)
  const [telling, setTelling] = useState(false)
  const [tellTo, setTellTo] = useState('')

  const retired = memory.active === false
  const inJournal = !journal && (memory.consolidatedFor ?? []).includes(character.id)
  const others = otherKnowers(memory.knownBy ?? [], character.id, nameOf)
  const candidates = telling ? tellCandidates(characters, memory, character) : []

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try { await action() } catch (e) { toastError(errorMessage(e)) } finally { setBusy(false) }
  }
  const saveEdit = () => run(async () => {
    const text = draft.trim()
    if (text && text !== memory.text) await memoriesApi.update(memory.id, { text })
    setEditing(false)
  })
  const forget = () => run(async () => {
    const ok = await confirmDialog({
      title: 'Forget this memory?',
      body: others.length
        ? `It is removed for everyone who knows it, ${others.join(', ')} included. This cannot be undone.`
        : 'It is removed for good. This cannot be undone.',
      confirmLabel: 'Forget',
      tone: 'danger',
    })
    if (ok) await memoriesApi.remove(memory.id)
  })
  const tell = () => run(async () => {
    if (!tellTo) return
    await memoriesApi.share(memory.id, { to: [tellTo], by: character.id })
    toastSuccess(`${nameOf(tellTo) ?? 'They'} knows now.`)
    setTelling(false)
    setTellTo('')
  })

  return (
    <div className={`rounded-xl border p-3 ${journal ? 'border-accent/30 bg-accent/5' : 'border-border'} ${retired ? 'opacity-55' : ''}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {journal ? (
          <span className={`${badgeClass} inline-flex items-center gap-1 bg-accent/12 text-accent`}>
            <BookOpen size={10} strokeWidth={2.25} aria-hidden="true" />Journal
          </span>
        ) : (
          <span className={`${badgeClass} bg-bg-sunken text-text-muted`}>{MEMORY_KIND_LABELS[memory.kind] ?? memory.kind}</span>
        )}
        {journal && memory.sceneLabel && <span className="text-[11px] text-text-muted">{memory.sceneLabel}</span>}
        {!journal && memory.certainty === 'claim' && <span className={`${badgeClass} bg-bg-sunken text-text-muted`} title="Someone said so; not seen firsthand">Heard</span>}
        {!journal && memory.certainty === 'belief' && <span className={`${badgeClass} bg-bg-sunken text-text-muted`} title="What they think, not something they saw">Belief</span>}
        {!journal && memory.verdict && (
          <span className={`${badgeClass} ${memory.verdict === 'true' ? 'bg-success/12 text-success' : 'bg-danger/12 text-danger'}`}
            title="Your ruling. The Game Master knows it; the characters do not.">
            {memory.canonFactId ? 'World canon' : `Ruled ${memory.verdict}`}
          </span>
        )}
        {memory.unresolved && <span className={`${badgeClass} bg-warning/12 text-warning`}>open thread</span>}
        {memory.pinned && (
          <span className="inline-flex text-accent" title="Pinned: always remembered">
            <Pin size={11} strokeWidth={2.25} aria-label="Pinned" />
          </span>
        )}
        {inJournal && <span className="text-[10px] text-text-muted" title={`Folded into ${character.card.name}'s journal`}>in journal</span>}
        {retired && <span className="text-[11px] italic text-text-muted">retired{memory.retiredReason ? `: ${memory.retiredReason}` : ''}</span>}
      </div>

      {editing ? (
        <div className="mt-2">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveEdit()
              if (e.key === 'Escape') setEditing(false)
            }}
            rows={Math.min(10, Math.max(2, Math.ceil(draft.length / 80)))}
            aria-label="Memory text"
            className="w-full resize-y rounded-lg bg-bg-sunken p-2 text-sm text-text outline-none ring-1 ring-accent/40"
          />
          <div className="mt-1 flex gap-1">
            <button className={actionClass} disabled={busy || !draft.trim()} onClick={saveEdit}>Save</button>
            <button className={actionClass} disabled={busy} onClick={() => { setEditing(false); setDraft(memory.text) }}>Cancel</button>
          </div>
        </div>
      ) : (
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-text">{memory.text}</p>
      )}

      {!journal && others.length > 0 && <p className="mt-1 text-[11px] text-text-muted">Also known by: {others.join(', ')}</p>}

      {telling && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {candidates.length ? (
            <>
              <select className={selectClass} value={tellTo} onChange={(e) => setTellTo(e.target.value)} aria-label="Tell who">
                <option value="">Tell who…</option>
                {candidates.map((c) => <option key={c.id} value={c.id}>{c.card.name}</option>)}
              </select>
              <button className={actionClass} disabled={busy || !tellTo} onClick={tell}>Tell</button>
            </>
          ) : (
            <span className="text-[11px] text-text-muted">Everyone in this world already knows.</span>
          )}
          <button className={actionClass} onClick={() => { setTelling(false); setTellTo('') }}>Cancel</button>
        </div>
      )}

      {!editing && (
        <div className="mt-1.5 flex flex-wrap gap-0.5">
          <button className={actionClass} disabled={busy} onClick={() => { setDraft(memory.text); setEditing(true) }}>Edit</button>
          {!journal && (
            <button className={actionClass} disabled={busy} onClick={() => run(() => memoriesApi.update(memory.id, { pinned: !memory.pinned }))}>
              {memory.pinned ? 'Unpin' : 'Pin'}
            </button>
          )}
          {!journal && memory.unresolved && (
            <button className={actionClass} disabled={busy} onClick={() => run(() => memoriesApi.update(memory.id, { unresolved: false }))}>Mark resolved</button>
          )}
          {!journal && !retired && !telling && <button className={actionClass} disabled={busy} onClick={() => setTelling(true)}>Tell…</button>}
          <button className={`${actionClass} hover:text-danger`} disabled={busy} onClick={forget}>Forget</button>
        </div>
      )}
    </div>
  )
}

function AddMemoryForm({ character, scenes }: { character: Character; scenes: ReturnType<typeof chatsWithCharacter> }) {
  const [text, setText] = useState('')
  const [chatId, setChatId] = useState('')
  const [busy, setBusy] = useState(false)
  // Defaults to the most recent scene, and follows the list if the chosen one disappears.
  const selected = scenes.some((s) => s.id === chatId) ? chatId : scenes[0]?.id ?? ''

  const add = async () => {
    const trimmed = text.trim()
    if (!trimmed || !selected || busy) return
    setBusy(true)
    try {
      await memoriesApi.create({ chatId: selected, text: trimmed, kind: 'event', witnesses: [character.id], importance: 0.5, origin: 'manual' })
      setText('')
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Add memory" description="Something they should remember. It stays in the story of the scene you pick." surface="sunken">
      <TextAreaField label="What they remember" rows={2} value={text} onChange={(e) => setText(e.target.value)}
        placeholder={`${character.card.name || 'They'} promised to meet Bea at the gate.`} />
      <SelectField label="Scene" value={selected} onChange={(e) => setChatId(e.target.value)}>
        {scenes.map((s) => <option key={s.id} value={s.id}>{chatOptionLabel(s)}</option>)}
      </SelectField>
      <Button variant="primary" onClick={add} disabled={busy || !text.trim() || !selected}>{busy ? 'Adding…' : 'Add memory'}</Button>
    </Section>
  )
}
