import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { NumberField, SelectField, TextAreaField } from '@/components/ui/Field'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { campaignNeedsTarget, sheetModifier, statForMove, type CampaignConfig, type CharacterSheet } from '@/lib/world/campaign'
import { describeDice } from '@/lib/world/customRules'

export function CampaignMovePanel({ campaign, sheet, sheetWorldMismatch = false, playerName, onClose, onSubmit, pendingCheck }: {
  campaign: CampaignConfig
  sheet?: CharacterSheet
  sheetWorldMismatch?: boolean
  playerName?: string
  onClose: () => void
  /** The server rolls and stores the result before the GM rules on it. */
  onSubmit: (moveId: string, modifier: number, action: string, messageId: string, target?: number, rollMode?: 'normal' | 'advantage' | 'disadvantage') => Promise<void>
  pendingCheck?: { messageId: string; moveId: string; action: string; target?: number }
}) {
  const [moveId, setMoveId] = useState(pendingCheck?.moveId ?? campaign.moves[0]?.id ?? '')
  const [modifier, setModifier] = useState(0)
  const [targetInput, setTargetInput] = useState('')
  const [rollMode, setRollMode] = useState<'normal' | 'advantage' | 'disadvantage'>('normal')
  const [action, setAction] = useState(pendingCheck?.action ?? '')
  const [messageId] = useState(() => crypto.randomUUID())
  const [rolling, setRolling] = useState(false)
  const move = campaign.moves.find((entry) => entry.id === moveId)
  const stat = move && statForMove(campaign, move)
  const savedModifier = move && sheet && !sheetWorldMismatch ? sheetModifier(campaign, move, sheet) : undefined
  const effectiveModifier = sheetWorldMismatch ? undefined : sheet ? savedModifier : modifier
  const needsTarget = campaignNeedsTarget(campaign)
  const target = move?.target ?? pendingCheck?.target ?? (targetInput.trim() ? Number(targetInput) : undefined)
  const targetValid = !needsTarget || target !== undefined && Number.isInteger(target) && target >= -30 && target <= 100
  const minModifier = campaign.resolver === 'pbta' ? -5 : campaign.resolver === 'roll-under' ? 0 : -100
  const maxModifier = campaign.resolver === 'pbta' ? 5 : 100
  const canRoll = !!move && !!action.trim() && effectiveModifier !== undefined && Number.isInteger(effectiveModifier) && effectiveModifier >= minModifier && effectiveModifier <= maxModifier && targetValid
  const roll = async () => {
    if (!move || rolling || !canRoll || effectiveModifier === undefined) return
    setRolling(true)
    try {
      await onSubmit(move.id, effectiveModifier, action.trim(), messageId, move.target === undefined ? target : undefined, rollMode)
      onClose()
    } catch (error) {
      toastError(errorMessage(error))
    } finally {
      setRolling(false)
    }
  }
  return <Modal title={pendingCheck ? 'Roll required' : 'Resolve a campaign move'} description={pendingCheck ? 'The GM has paused this action until you roll. The dice result will decide what happens next.' : `Use the world’s ${campaign.resolver === 'custom' ? campaign.ruleset : campaign.resolver} check rules. The result is saved before the GM continues.`} onClose={onClose} size="lg">
    {move ? <div className="space-y-3">
      <SelectField label="Move" value={moveId} disabled={!!pendingCheck || rolling} onChange={(event) => setMoveId(event.target.value)}>
        {campaign.moves.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </SelectField>
      <p className="text-xs text-text-muted">When {move.trigger}</p>
      {campaign.resolver === 'custom' && campaign.custom && <p className="text-xs text-text-muted">{describeDice(campaign.custom.dice)}</p>}
      <TextAreaField label="What are you doing?" value={action} disabled={!!pendingCheck || rolling} onChange={(event) => setAction(event.target.value)} rows={3} />
      {sheetWorldMismatch ? <p className="rounded-lg border border-border bg-bg-sunken p-3 text-sm text-text">{playerName ?? 'This character'} has sheets, but none for this story’s world. Add one in Cast → Sheet before rolling.</p>
        : sheet ? <p className="rounded-lg border border-border bg-bg-sunken p-3 text-sm text-text">
          {savedModifier === undefined ? `Set ${stat?.name ?? 'this move’s stat'} on ${playerName ?? 'the player character'}’s sheet in Cast before rolling.`
            : `${playerName ?? 'Player'}’s ${stat?.name ?? move.stat}: ${stat?.valueMode === 'ability' ? `${sheet.stats[stat.id]} score gives ` : ''}${savedModifier >= 0 && campaign.resolver !== 'roll-under' ? '+' : ''}${savedModifier} from the character sheet`}
        </p> : <NumberField label={`${stat?.name ?? move.stat} ${campaign.resolver === 'roll-under' ? 'target' : campaign.resolver === 'custom' && campaign.custom?.dice.pool ? 'dice' : 'modifier'}`} min={minModifier} max={maxModifier} step={1} value={modifier} disabled={rolling} onChange={(event) => setModifier(Number(event.target.value))} hint="No sheet is saved for this story. Add one in Cast → Sheet to use saved values." />}
      {needsTarget && (move.target !== undefined || pendingCheck?.target !== undefined ? <p className="text-sm text-text-muted">{move.target !== undefined ? 'Difficulty set by the world' : 'Difficulty set by the GM'}: {target}</p>
        : <NumberField label={campaign.resolver === 'fate' ? 'Opposition' : 'Difficulty class'} min={-30} max={100} step={1} value={targetInput} disabled={rolling} onChange={(event) => setTargetInput(event.target.value)} hint="Set the target for this check before rolling. The result records the target and whether the check failed." />)}
      {(campaign.resolver === 'd20' || campaign.resolver === 'd20-degree') && <SelectField label="Roll mode" value={rollMode} disabled={rolling} onChange={(event) => setRollMode(event.target.value as typeof rollMode)}><option value="normal">Normal</option><option value="advantage">Advantage</option><option value="disadvantage">Disadvantage</option></SelectField>}
      <Button variant="primary" disabled={rolling || !canRoll} onClick={roll}>{rolling ? 'Rolling…' : pendingCheck ? 'Roll and resolve check' : 'Roll and continue story'}</Button>
    </div> : <p className="text-sm text-text-muted">Add a move in the world’s Story Rules tab first.</p>}
  </Modal>
}
