import { Gauge } from 'lucide-react'
import type { SceneBreakHint } from '@/lib/story/sceneBreak'
import { SCENE_CONTEXT_URGENT, SCENE_CONTEXT_WARN } from '@/lib/story/sceneBreak'

interface ContextMeterProps {
  /** Tokens the current scene's prompt uses. */
  used: number
  /** The model's context budget, in tokens. */
  budget: number
  hint: SceneBreakHint | null
  onEndScene: () => void
  /** Header-row form: icon + percentage only, with the suggestion chip as its own element beside it. */
  compact?: boolean
}

type Tone = 'ok' | 'warn' | 'danger'

const TEXT_TONE: Record<Tone, string> = {
  ok: 'text-text-muted',
  warn: 'text-warning',
  danger: 'text-danger',
}
const FILL_TONE: Record<Tone, string> = {
  ok: 'bg-accent',
  warn: 'bg-warning',
  danger: 'bg-danger',
}

const formatTokens = (n: number) => Math.max(0, Math.round(n)).toLocaleString()

/**
 * How full the scene's context is, plus a nudge to end the scene when `sceneBreakHint` says so.
 * Static on purpose: no transitions or pulsing, the colour and chip carry the urgency.
 */
export function ContextMeter({ used, budget, hint, onEndScene, compact = false }: ContextMeterProps) {
  const ratio = budget > 0 ? used / budget : 0
  const pct = Math.max(0, Math.round(ratio * 100))
  const tone: Tone = ratio >= SCENE_CONTEXT_URGENT ? 'danger' : ratio >= SCENE_CONTEXT_WARN ? 'warn' : 'ok'
  const detail = `~${formatTokens(used)} of ${formatTokens(budget)} tokens`
  const label = `Scene context: ${pct}% used, ${detail}`

  const meter = (
    <div
      role="meter"
      aria-valuenow={Math.min(pct, 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={`${pct}%, ${detail}`}
      aria-label="Scene context used"
      title={label}
      className={`inline-flex shrink-0 items-center gap-1.5 text-xs tabular-nums ${TEXT_TONE[tone]}`}
    >
      {compact ? (
        <Gauge size={14} strokeWidth={2} aria-hidden="true" className="shrink-0" />
      ) : (
        <span aria-hidden="true" className="block h-1.5 w-14 overflow-hidden rounded-full bg-bg-sunken ring-1 ring-border sm:w-20">
          <span className={`block h-full ${FILL_TONE[tone]}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        </span>
      )}
      <span aria-hidden="true">{pct}%</span>
    </div>
  )

  if (!hint) return meter

  const chipTone = hint.urgent
    ? 'bg-danger/10 text-danger ring-danger/30'
    : 'bg-warning/10 text-warning ring-warning/30'

  const chip = (
    <div
      role="status"
      className={`inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg py-0.5 pl-2.5 pr-0.5 text-xs ring-1 ${chipTone}`}
    >
      <span className="min-w-0 truncate" title={hint.reason}>
        {hint.reason}
      </span>
      <button
        type="button"
        onClick={onEndScene}
        className="shrink-0 rounded-md bg-bg-elevated px-2 py-1 font-medium text-text ring-1 ring-border hover:bg-bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        End scene
      </button>
    </div>
  )

  return (
    <div className={`flex min-w-0 max-w-full items-center gap-2 ${compact ? '' : 'flex-wrap'}`}>
      {meter}
      {chip}
    </div>
  )
}
