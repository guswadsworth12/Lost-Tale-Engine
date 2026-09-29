import { createContext, useContext, useState } from 'react'
import { Check, Dices, X } from 'lucide-react'
import type { StoredMessage } from '@/lib/types'
import { adjudicationLabel, type GmProposal } from '@/lib/world/gm'
import { effectsText, parseEffects, type CampaignTrack, type NamedCharacter, type TrackEffect } from '@/lib/world/gameState'

/**
 * What a GM turn needs from the chat around it — supplied once by `ChatWindow` rather than threaded
 * through `MessageLog` → `MessageBubble` as props, since only GM turns ever read it.
 */
export const GmActionsContext = createContext<{
  /** `changes`: the player's corrected version of a proposal's tracked-state changes. */
  decideProposal?: (messageId: string, proposalId: string, decision: 'confirmed' | 'rejected', changes?: TrackEffect[]) => void
  nameOf?: (characterId: string) => string
  openChat?: (chatId: string) => void
  pendingCheckMessageId?: string
  rollForCheck?: (messageId: string, moveId: string, action: string) => void
  /** The world's tracked state (`world/gameState.ts`) and who can hold it, to show and read changes by name. */
  tracks?: CampaignTrack[]
  people?: NamedCharacter[]
}>({})

const SOURCE_TONE = {
  recorded_roll: 'bg-accent/12 text-accent',
  roll_needed: 'bg-warning/15 text-warning',
  guided_judgment: 'bg-bg-sunken text-text-muted',
  set_event: 'bg-success/15 text-success',
} as const

/** The recorded dice on a player turn, so the roll that the GM honored is visible where it was made. */
export function CampaignRollBadge({ message }: { message: StoredMessage }) {
  const { tracks, people } = useContext(GmActionsContext)
  const roll = message.campaignRoll
  if (!roll) return null
  const failed = roll.tier === 'miss'
  const result = roll.resolver === 'roll-under'
    ? `3d6 ${roll.dice.join(' + ')} = ${roll.total} vs skill ${roll.target}`
    : roll.resolver === 'fate'
      ? `4dF ${roll.dice.map((die) => die > 0 ? '+' : die < 0 ? '−' : '0').join(' ')} + ${roll.modifier} = ${roll.total} vs ${roll.target}`
      : roll.resolver === 'd20' || roll.resolver === 'd20-degree'
        ? `d20 ${roll.dice.join(', ')}${roll.rollMode && roll.rollMode !== 'normal' ? ` (${roll.rollMode}: ${roll.natural})` : ''} ${roll.modifier >= 0 ? '+' : '−'} ${Math.abs(roll.modifier)} = ${roll.total} vs ${roll.target}`
        : `${roll.dice[0]} + ${roll.dice[1]} ${roll.modifier >= 0 ? '+' : '−'} ${Math.abs(roll.modifier)} ${roll.stat} = ${roll.total}`
  return (
    <div className={`mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] ${failed ? 'bg-danger/10 text-danger' : 'bg-accent/10 text-accent'}`}>
      <Dices size={12} strokeWidth={2} />
      {failed ? 'Failed check · ' : ''}{roll.moveName}: {result} ({roll.degree ?? roll.tier}){roll.modifierSource === 'sheet' ? ' · sheet' : ''}
      {!!roll.stateChanges?.length && !!tracks?.length && <> · {effectsText(roll.stateChanges, tracks, people)}</>}
    </div>
  )
}

/** One proposal. A proposed state change can be corrected before it is confirmed. */
function ProposalRow({ messageId, proposal }: { messageId: string; proposal: GmProposal }) {
  const { decideProposal, tracks, people } = useContext(GmActionsContext)
  const proposed = proposal.changes?.length ? effectsText(proposal.changes, tracks, people) : ''
  const [change, setChange] = useState(proposed)
  const [problem, setProblem] = useState('')
  const pending = proposal.status === 'pending' && !!decideProposal
  const confirm = () => {
    if (!proposal.changes?.length || change === proposed) return decideProposal?.(messageId, proposal.id, 'confirmed')
    const parsed = parseEffects(change, tracks, people)
    if (parsed.errors.length) return setProblem(parsed.errors[0])
    decideProposal?.(messageId, proposal.id, 'confirmed', parsed.effects)
  }
  return (
    <div className="rounded-lg bg-bg px-2 py-1.5">
      <div className="flex items-start gap-2">
        <span className="flex-1">
          <span className="mr-1 rounded bg-bg-sunken px-1 text-[10px] uppercase tracking-wide">{proposal.scope === 'world' ? 'World canon' : 'This branch'}</span>
          <span className="text-text">{proposal.text}</span>
        </span>
        {pending ? (
          <span className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={confirm}
              className="flex items-center gap-0.5 rounded-md bg-accent/15 px-1.5 py-0.5 text-accent hover:bg-accent/25"
              aria-label={`Confirm: ${proposal.text}`}
            >
              <Check size={11} strokeWidth={2.5} /> Confirm
            </button>
            <button
              type="button"
              onClick={() => decideProposal?.(messageId, proposal.id, 'rejected')}
              className="flex items-center gap-0.5 rounded-md px-1.5 py-0.5 hover:bg-bg-sunken hover:text-text"
              aria-label={`Reject: ${proposal.text}`}
            >
              <X size={11} strokeWidth={2.5} /> Reject
            </button>
          </span>
        ) : (
          <span className={`shrink-0 ${proposal.status === 'confirmed' ? 'text-accent' : ''}`}>{proposal.status}</span>
        )}
      </div>
      {!!proposal.changes?.length && (pending ? (
        <label className="mt-1 flex items-center gap-1.5">
          <span className="shrink-0">State:</span>
          <input
            className="min-w-0 flex-1 rounded border border-border bg-bg-sunken px-1.5 py-0.5 text-[11px] text-text outline-none focus:border-accent"
            value={change}
            onChange={(e) => { setChange(e.target.value); setProblem('') }}
            aria-label={`State change for: ${proposal.text}`}
          />
        </label>
      ) : <p className="mt-1">State: {proposed}</p>)}
      {problem && <p className="mt-1 text-danger">{problem}</p>}
    </div>
  )
}

export function GmTurnCard({ message }: { message: StoredMessage }) {
  const { nameOf, openChat, pendingCheckMessageId, rollForCheck, tracks, people } = useContext(GmActionsContext)
  const turn = message.gm
  if (!turn) return null
  const adj = turn.adjudication
  return (
    <div className="mt-2 space-y-1.5 rounded-xl border border-border bg-bg-sunken/60 p-2.5 text-[11px] text-text-muted">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-bg px-1.5 py-px font-medium text-text">
          {turn.mode === 'mechanical' ? 'Mechanical' : 'Guided'} · {turn.ruleset}
        </span>
        {adj && <span className={`rounded-full px-1.5 py-px font-medium ${adj.source === 'recorded_roll' && adj.tier === 'miss' ? 'bg-danger/15 text-danger' : SOURCE_TONE[adj.source]}`}>{adjudicationLabel(adj)}</span>}
        <span className="rounded-full bg-bg px-1.5 py-px">Pacing: {turn.pacing}</span>
        {turn.speakerIds.length > 0 && (
          <span className="rounded-full bg-bg px-1.5 py-px">Acts: {turn.speakerIds.map((id) => nameOf?.(id) ?? id).join(' → ')}</span>
        )}
      </div>
      {turn.mode === 'guided' && (
        <p>Guided mode: the GM judges outcomes from the ruleset’s spirit. This is not rules enforcement.</p>
      )}
      {adj?.source === 'roll_needed' && adj.moveId && pendingCheckMessageId === message.id && rollForCheck && (
        <button type="button" onClick={() => rollForCheck(message.id, adj.moveId!, adj.action)} className="inline-flex items-center gap-1.5 rounded-lg bg-warning/15 px-2 py-1 font-medium text-warning hover:bg-warning/25">
          <Dices size={13} /> Roll {adj.moveName}
        </button>
      )}
      {turn.fallback && <p className="text-warning">GM fallback: {turn.fallback}</p>}
      {turn.corrections?.map((c) => <p key={c}>Engine correction: {c}</p>)}
      {!!turn.stateChanges?.length && !!tracks?.length && <p className="text-text">State: {effectsText(turn.stateChanges, tracks, people)}</p>}
      {!!turn.addCharacterIds?.length && <p>Entered scene: {turn.addCharacterIds.map((id) => nameOf?.(id) ?? id).join(', ')}</p>}
      {turn.fork?.chatId && <p>New story branch: <button type="button" className="text-accent underline" onClick={() => openChat?.(turn.fork!.chatId!)}>{turn.fork.title}</button> — {turn.fork.reason}</p>}
      {turn.proposals.length > 0 && (
        <div className="space-y-1">
          <p className="font-medium text-text">Proposed lasting changes</p>
          {turn.proposals.map((p) => <ProposalRow key={p.id} messageId={message.id} proposal={p} />)}
        </div>
      )}
    </div>
  )
}
