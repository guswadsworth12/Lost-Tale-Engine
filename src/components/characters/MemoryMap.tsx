import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { Character } from '@/lib/characters/cardSpec'
import type { ExplorerMemory, ExplorerSubject, MemoryExplorer } from '@/lib/memory/explorer'
import { memoryMap, type MapDot, type MapHub } from '@/lib/memory/memoryMap'
import { Chip } from '@/components/ui/Chip'

type Focus = { hub: string } | { dot: string } | null

const HUB_STROKE: Record<MapHub['kind'], string> = {
  person: 'stroke-accent',
  place: 'stroke-success',
  thing: 'stroke-warning',
  self: 'stroke-text-muted',
  others: 'stroke-text-muted',
}

/** Fill for a memory dot: strongly felt memories stand out, faded and summarized ones go pale. */
export function dotTone(memory: ExplorerMemory, characterId: string): string {
  if (memory.status === 'retired') return 'fill-transparent stroke-text-muted'
  if (memory.status === 'faded' || memory.status === 'summarized') return 'fill-text-muted/40'
  return Math.abs(memory.feelings?.[characterId] ?? 0) >= 0.5 ? 'fill-romance' : 'fill-accent'
}

function labelAt(hub: MapHub, centre: number): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  const dx = hub.x - centre, dy = hub.y - centre
  const anchor = dx > 40 ? 'start' : dx < -40 ? 'end' : 'middle'
  const x = hub.x + (anchor === 'start' ? hub.r + 8 : anchor === 'end' ? -hub.r - 8 : 0)
  const y = anchor !== 'middle' ? hub.y + 4 : dy < 0 ? hub.y - hub.r - 20 : hub.y + hub.r + 18
  return { x, y, anchor }
}

const pressable = (action: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); action() }
}

const plural = (n: number) => `${n} ${n === 1 ? 'memory' : 'memories'}`

/**
 * A character's memories as a web: people, places and things are circles on a ring, and each
 * memory is a dot drawn toward everyone and everywhere it involves. Click a circle to light up its
 * memories, or a dot to read the memory and pin, fade or bring it back.
 */
export function MemoryMap({ data, character, subjectName, renderMemory }: {
  data: MemoryExplorer
  character: Character
  subjectName: (subject: ExplorerSubject) => string
  renderMemory: (memory: ExplorerMemory) => ReactNode
}) {
  const [showRetired, setShowRetired] = useState(false)
  const [focus, setFocus] = useState<Focus>(null)
  const [hover, setHover] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const name = character.card.name || 'this character'
  const layout = useMemo(() => memoryMap({
    memories: data.memories, subjects: data.subjects, connections: data.connections,
    characterId: character.id, label: subjectName, selfLabel: name, showRetired,
  }), [data, character.id, subjectName, name, showRetired])
  const total = data.memories.filter((m) => m.kind !== 'journal' && (showRetired || m.status !== 'retired')).length

  // A map bigger than its box opens centred, so a phone starts on the middle of the web.
  useEffect(() => {
    const el = scrollRef.current
    if (el) { el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2; el.scrollTop = (el.scrollHeight - el.clientHeight) / 2 }
  }, [layout.size])

  const hubAt = new Map(layout.hubs.map((h) => [h.key, h]))
  const focusHub = focus && 'hub' in focus ? hubAt.get(focus.hub) : undefined
  const focusDot = focus && 'dot' in focus ? layout.dots.find((d) => d.id === focus.dot) : undefined
  const litHub = focusHub?.key ?? (hover.startsWith('hub:') ? hover.slice(4) : '')
  const lit = (dot: MapDot) => focusDot ? dot.id === focusDot.id : litHub ? dot.hubKeys.includes(litHub) : true
  const toggle = (next: NonNullable<Focus>) => setFocus((f) => JSON.stringify(f) === JSON.stringify(next) ? null : next)
  const centre = layout.size / 2
  const edgesOf = (key: string) => layout.edges.filter((e) => e.from === key || e.to === key)

  if (!layout.dots.length) return <p className="text-sm text-text-muted">No memories to map in this branch yet.</p>

  return <div className="min-w-0">
    <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-text-muted">
      <Chip on={showRetired} onClick={() => setShowRetired((v) => !v)}>Show retired</Chip>
      <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="fill-accent" /></svg>Memory</span>
      <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="fill-romance" /></svg>Strongly felt</span>
      <span className="flex items-center gap-1"><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" className="fill-text-muted/40" /></svg>Faded</span>
      <span className="flex items-center gap-1"><svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="3" className="fill-accent" /><circle cx="6" cy="6" r="5.25" className="fill-none stroke-accent" strokeWidth="1.2" /></svg>Pinned</span>
      <span>Bigger dots matter more</span>
    </div>
    {total > layout.dots.length && <p className="mb-2 text-xs text-text-muted">Showing the newest {layout.dots.length} of {total} memories.</p>}
    <div ref={scrollRef} className="max-h-[70vh] overflow-auto rounded-xl border border-border bg-bg-sunken/40">
      <svg
        viewBox={`0 0 ${layout.size} ${layout.size}`}
        // Fits the box on a wide screen (no taller than most of the window); on a phone it keeps
        // a size where dots can be tapped, and the box scrolls.
        style={{ width: '100%', maxWidth: '70vh', minWidth: Math.min(layout.size, 560) }}
        className="mx-auto block select-none" role="group" aria-label={`Map of ${plural(layout.dots.length)} ${name} has`}
        onClick={(e) => { if (e.target === e.currentTarget) setFocus(null) }}
      >
        {layout.dots.flatMap((dot) => dot.hubKeys.map((key) => {
          const hub = hubAt.get(key)
          if (!hub) return null
          const on = focusDot ? focusDot.id === dot.id : litHub === key
          return <line key={`${dot.id}:${key}`} x1={dot.x} y1={dot.y} x2={hub.x} y2={hub.y}
            className={on ? 'stroke-accent' : 'stroke-text-muted'} strokeOpacity={on ? 0.6 : litHub || focusDot ? 0.04 : 0.1} strokeWidth={on ? 1.2 : 1} />
        }))}
        {layout.edges.map((edge) => {
          const a = hubAt.get(edge.from)!, b = hubAt.get(edge.to)!
          const on = !litHub || litHub === edge.from || litHub === edge.to
          return <g key={edge.key} opacity={on ? 1 : 0.2}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-accent" strokeWidth={2} strokeDasharray={edge.open ? undefined : '6 5'} strokeOpacity={0.55} />
            <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 6} textAnchor="middle" className="fill-text text-[11px]">{edge.relation}{edge.open ? '' : ' (ended)'}</text>
          </g>
        })}
        {layout.dots.map((dot) => {
          const m = dot.memory, picked = focusDot?.id === dot.id
          return <g key={dot.id} role="button" aria-label={m.text} className="cursor-pointer" opacity={lit(dot) ? 1 : 0.15}
            onClick={() => toggle({ dot: dot.id })}>
            <title>{m.text.length > 160 ? `${m.text.slice(0, 157)}…` : m.text}</title>
            <circle cx={dot.x} cy={dot.y} r={Math.max(dot.r, 10)} fill="transparent" />
            {(m.pinned || picked) && <circle cx={dot.x} cy={dot.y} r={dot.r + 3.5} className={`fill-none ${picked ? 'stroke-text' : 'stroke-accent'}`} strokeWidth={picked ? 2 : 1.4} />}
            <circle cx={dot.x} cy={dot.y} r={dot.r} className={dotTone(m, character.id)} strokeWidth={1.4} />
          </g>
        })}
        {layout.hubs.map((hub) => {
          const label = labelAt(hub, centre), on = !litHub || litHub === hub.key || !!focusDot?.hubKeys.includes(hub.key)
          const pick = () => toggle({ hub: hub.key })
          return <g key={hub.key} role="button" tabIndex={0} aria-pressed={focusHub?.key === hub.key} aria-label={`${hub.label}, ${plural(hub.memoryIds.length)}`}
            className="cursor-pointer outline-none" opacity={on ? 1 : 0.35} onClick={pick} onKeyDown={pressable(pick)}
            onMouseEnter={() => setHover(`hub:${hub.key}`)} onMouseLeave={() => setHover('')}>
            <circle cx={hub.x} cy={hub.y} r={hub.r} className={`fill-bg-elevated ${HUB_STROKE[hub.kind]}`} strokeWidth={focusHub?.key === hub.key ? 3.5 : 2}
              strokeDasharray={hub.kind === 'self' || hub.kind === 'others' ? '4 4' : undefined} />
            <text x={label.x} y={label.y} textAnchor={label.anchor} className="fill-text text-[13px] font-medium">{hub.label}</text>
            <text x={label.x} y={label.y + 14} textAnchor={label.anchor} className="fill-text-muted text-[11px]">{plural(hub.memoryIds.length)}</text>
          </g>
        })}
      </svg>
    </div>
    <div className="mt-4">
      {focusDot ? <>
        <p className="mb-2 text-xs text-text-muted">Involves {focusDot.hubKeys.map((k) => hubAt.get(k)?.label).filter(Boolean).join(', ') || 'no one else'}</p>
        {renderMemory(focusDot.memory)}
      </> : focusHub ? <>
        <h4 className="mb-1 break-words font-display text-lg">{focusHub.label}</h4>
        <p className="mb-3 text-xs text-text-muted">{plural(focusHub.memoryIds.length)}{edgesOf(focusHub.key).map((e) => ` · ${hubAt.get(e.from)?.label} ${e.relation} ${hubAt.get(e.to)?.label}${e.open ? '' : ' (ended)'}`).join('')}</p>
        <div className="max-h-[28rem] overflow-auto pr-1">
          {layout.dots.filter((d) => d.hubKeys.includes(focusHub.key)).map((d) => <div key={d.id}>{renderMemory(d.memory)}</div>)}
        </div>
      </> : <p className="text-sm text-text-muted">Tap a circle to light up everything about that person or place, or a dot to read the memory. Memories about two people sit between them.</p>}
    </div>
  </div>
}
