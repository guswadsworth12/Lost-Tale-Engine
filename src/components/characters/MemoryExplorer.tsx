import { useState } from 'react'
import type { Character } from '@/lib/characters/cardSpec'
import type { Chat } from '@/lib/types'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { memoryExplorerApi, memoriesApi } from '@/lib/api/client'
import { LINK_RELATIONS } from '@/lib/memory/links'
import type { ExplorerMemory, MemoryExplorer } from '@/lib/memory/explorer'
import { Section } from '@/components/ui/Section'
import { chatOptionLabel } from './memoriesView'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'
const actionClass = 'rounded-md px-2 py-1 text-xs text-text-muted hover:bg-bg-sunken hover:text-text disabled:opacity-40'
const inputClass = 'w-full min-w-0 rounded-lg bg-bg-sunken px-3 py-2 text-sm text-text'
const kindLabel = { person: 'Person', place: 'Place', thing: 'Thing' }
export function recallWhen(at: number, now = Date.now()): string {
  const days = Math.max(0, Math.floor((now - at) / 86400_000))
  return days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`
}
export function MemoryExplorerSection({ character, scenes, characters }: { character: Character; scenes: Chat[]; characters: Character[] }) {
  const [sceneId, setSceneId] = useState('')
  const selected = scenes.some((s) => s.id === sceneId) ? sceneId : scenes[0]?.id ?? ''
  return <Section title={`What ${character.card.name || 'this character'} knows about`} surface="bare">
    {!selected ? <p className="text-sm text-text-muted">Start a scene with this character to explore what they know.</p> : <>
      <label className="mb-4 block text-xs text-text-muted">As of scene
        <select className={`${inputClass} mt-1`} value={selected} onChange={(e) => setSceneId(e.target.value)}>
          {scenes.map((s) => <option key={s.id} value={s.id}>{chatOptionLabel(s)}</option>)}
        </select>
      </label>
      <SceneExplorer key={selected} character={character} chatId={selected} characters={characters} />
    </>}
  </Section>
}
function SceneExplorer({ character, chatId, characters }: { character: Character; chatId: string; characters: Character[] }) {
  const data = useApiQuery('memories', () => memoryExplorerApi.read(chatId, character.id), [chatId, character.id])
  const [picked, setPicked] = useState('')
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const names = new Map(characters.map((c) => [c.id, c.card.name]))
  const nameOf = (kind: string, id: string) => kind === 'person' ? names.get(id) || 'Someone' : kind === 'memory' ? 'Earlier memory' : data?.subjects.find((s) => s.kind === kind && s.id === id)?.displayLabel || id
  const subjectName = (s: import('@/lib/memory/explorer').ExplorerSubject) => nameOf(s.kind, s.id)
  const subject = data?.subjects.find((s) => s.key === picked)
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try { await action() } catch (error) { toastError(errorMessage(error)) } finally { setBusy(false) }
  }
  if (!data) return <p className="text-sm text-text-muted">Loading what they know…</p>
  return <ExplorerLayout data={data} picked={!!subject} list={<>
    <input className={inputClass} aria-label="Filter people, places and things" placeholder="Find a person, place or thing…" value={filter} onChange={(e) => setFilter(e.target.value)} />
    <ul className="mt-3 space-y-1">
      {data.subjects.filter((s) => subjectName(s).toLowerCase().includes(filter.toLowerCase())).map((s) => <li key={s.key}>
        <button onClick={() => setPicked(s.key)} aria-pressed={picked === s.key} className={`w-full rounded-lg px-3 py-2 text-left ${picked === s.key ? 'bg-accent/10 text-accent' : 'hover:bg-bg-sunken'}`}>
          <span className="block break-words text-sm">{subjectName(s)}</span>
          <span className="text-xs text-text-muted">{kindLabel[s.kind]} · {s.memoryIds.length} {s.memoryIds.length === 1 ? 'memory' : 'memories'}</span>
        </button>
      </li>)}
    </ul>
    {!data.subjects.length && <p className="mt-3 text-sm text-text-muted">No people, places or things recorded in this branch yet.</p>}
  </>} detail={subject ? <>
    <button className={`${actionClass} mb-3 md:hidden`} onClick={() => setPicked('')}>← Back to people, places and things</button>
    <h4 className="mb-4 break-words font-display text-lg">{subjectName(subject)}</h4>
    {data.connections.filter((l) => subject.linkIds.includes(l.id)).map((l) => <div key={l.id} className="mb-3 rounded-xl border border-border p-3">
      <p className="break-words text-sm">{nameOf(l.fromKind, l.fromId)} {l.relation} {nameOf(l.toKind, l.toId)} · since {l.startedScene}
        {l.validTo !== null ? ` · until ${l.endedScene || new Date(l.validTo).toLocaleDateString()}` : ''}
        {l.closedBy === 'player' ? ' · closed by you' : ''} · {l.effectiveWeight >= 0.5 ? 'strong' : 'faint'}</p>
      {l.relation !== 'supersedes' && <div className="mt-2 flex flex-wrap items-center gap-1">
        <select aria-label="Change connection relation" className="min-w-0 rounded-md bg-bg-sunken p-1 text-xs" disabled={busy} value={l.relation} onChange={(e) => run(() => memoryExplorerApi.connection(l.id, 'relation', e.target.value))}>
          {LINK_RELATIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <button className={actionClass} disabled={busy || (l.validTo !== null && !data.memories.find((m) => m.id === l.memoryId)?.active)} onClick={() => run(() => memoryExplorerApi.connection(l.id, l.validTo === null ? 'close' : 'reopen', undefined, chatId))}>{l.validTo === null ? 'Close' : 'Reopen'}</button>
        <button className={actionClass} disabled={busy} onClick={() => run(async () => {
          if (await confirmDialog({ title: 'Remove this connection?', body: 'The memory stays. Only this connection is removed.', confirmLabel: 'Remove', tone: 'danger' })) await memoryExplorerApi.connection(l.id, 'remove')
        })}>Remove</button>
      </div>}
    </div>)}
    <h5 className="mb-2 text-sm font-medium">Memories</h5>
    {data.memories.filter((m) => subject.memoryIds.includes(m.id)).map((m) => <ExplorerMemoryCard key={m.id} memory={m} character={character} chatId={chatId} busy={busy} run={run} />)}
  </> : <p className="text-sm text-text-muted">Choose a person, place or thing to see their connections and memories.</p>} />
}
/** Phone navigation replaces the list with a full-width detail; desktop keeps both visible. */
export function ExplorerLayout({ data, picked, list, detail }: { data: Pick<MemoryExplorer, 'deepMemory'>; picked: boolean; list: React.ReactNode; detail: React.ReactNode }) {
  return <>
    {!data.deepMemory && <p className="mb-3 text-xs text-text-muted">Connections are recorded when Deep Memory is on.</p>}
    <div className="grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div className={`min-w-0 ${picked ? 'hidden md:block' : ''}`}>{list}</div>
      <div className={`min-w-0 ${picked ? '' : 'hidden md:block'}`}>{detail}</div>
    </div>
  </>
}
function ExplorerMemoryCard({ memory: m, character, chatId, busy, run }: { memory: ExplorerMemory; character: Character; chatId: string; busy: boolean; run: (action: () => Promise<unknown>) => Promise<void> }) {
  return <div className="mb-3 rounded-xl border border-border p-3">
    <div className="flex flex-wrap gap-2 text-xs text-text-muted"><span>{m.status === 'summarized' ? 'Part of a summary' : m.status[0].toUpperCase() + m.status.slice(1)}</span>{m.pinned && <span>Pinned</span>}{m.unresolved && <span>Open thread</span>}</div>
    <p className="my-2 whitespace-pre-wrap break-words text-sm">{m.text}</p>
    <p className="text-xs text-text-muted">Remembered {m.recall.count} {m.recall.count === 1 ? 'time' : 'times'}{m.recall.lastAt ? ` · last ${recallWhen(m.recall.lastAt)}` : ''}</p>
    <div className="mt-2 flex flex-wrap gap-1">
      <button className={actionClass} disabled={busy} onClick={() => run(() => memoriesApi.update(m.id, { pinned: !m.pinned }))}>{m.pinned ? 'Unpin' : 'Pin'}</button>
      {m.status === 'summarized' ? <p className="text-xs text-text-muted">To bring this back, use Undo in World settings → Deep Memory → Recent runs.</p> : m.kind !== 'journal' && m.active && <button className={actionClass} disabled={busy} onClick={() => run(() => m.status === 'faded' ? memoryExplorerApi.unfade(m.id, character.id, chatId) : memoriesApi.consolidate(character.id, [m.id]))}>{m.status === 'faded' ? 'Bring back' : `Fade for ${character.card.name}`}</button>}
    </div>
  </div>
}
