import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { NumberField, SelectField, TextAreaField } from '@/components/ui/Field'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { sheetModifier, statForMove, type CampaignConfig, type CharacterSheet } from '@/lib/world/campaign'

export function CampaignMovePanel({ campaign, sheet, sheetWorldMismatch = false, playerName, onClose, onSubmit, pendingCheck }: {
  campaign: CampaignConfig
  sheet?: CharacterSheet
  sheetWorldMismatch?: boolean
  playerName?: string
  onClose: () => void
  /** The server rolls and stores the result before the GM rules on it. */
  onSubmit: (moveId: string, modifier: number, action: string, messageId: string) => Promise<void>
  pendingCheck?: { moveId: string; action: string }
}) {
  const [moveId, setMoveId] = useState(pendingCheck?.moveId ?? campaign.moves[0]?.id ?? '')
  const [modifier, setModifier] = useState(0)
  const [action, setAction] = useState(pendingCheck?.action ?? '')
  const [messageId] = useState(() => crypto.randomUUID())
  const [rolling, setRolling] = useState(false)
  const move = campaign.moves.find((entry) => entry.id === moveId)
  const stat = move && statForMove(campaign, move)
  const savedModifier = move && sheet && !sheetWorldMismatch ? sheetModifier(campaign, move, sheet) : undefined
  const effectiveModifier = sheet ? savedModifier : modifier
  const roll = async () => {
    if (!move || rolling || effectiveModifier === undefined || !Number.isInteger(effectiveModifier) || effectiveModifier < -5 || effectiveModifier > 5) return
    setRolling(true)
    try {
      await onSubmit(move.id, effectiveModifier, action.trim(), messageId)
      onClose()
    } catch (error) {
      toastError(errorMessage(error))
    } finally {
      setRolling(false)
    }
  }
  return <Modal title={pendingCheck ? 'Roll required' : 'Resolve a campaign move'} description={pendingCheck ? 'The GM has paused this action until you roll. The dice result will decide what happens next.' : 'Roll 2d6 plus a modifier. The result is saved as a story turn and guides the next reply.'} onClose={onClose} size="lg">
    {move ? <div className="space-y-3">
      <SelectField label="Move" value={moveId} disabled={!!pendingCheck || rolling} onChange={(event) => setMoveId(event.target.value)}>
        {campaign.moves.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </SelectField>
      <p className="text-xs text-text-muted">When {move.trigger}</p>
      <TextAreaField label="What are you doing?" value={action} disabled={!!pendingCheck || rolling} onChange={(event) => setAction(event.target.value)} rows={3} />
      {sheet ? <p className="rounded-lg border border-border bg-bg-sunken p-3 text-sm text-text">
        {sheetWorldMismatch ? `This sheet belongs to another world. Bind ${playerName ?? 'the player character'} to this world and save the Sheet tab in Cast.`
          : savedModifier === undefined ? `Set ${stat?.name ?? 'this move’s stat'} on ${playerName ?? 'the player character'}’s sheet in Cast before rolling.`
          : `${playerName ?? 'Player'}’s ${stat?.name ?? move.stat}: ${savedModifier >= 0 ? '+' : ''}${savedModifier} from the character sheet`}
      </p> : <NumberField label={`${stat?.name ?? move.stat} modifier`} min={-5} max={5} step={1} value={modifier} disabled={rolling} onChange={(event) => setModifier(Number(event.target.value))} hint="No player character sheet is selected for this story, so enter the modifier manually. Add a player character and fill in its Sheet tab to use saved stats." />}
      <Button variant="primary" disabled={rolling || !action.trim() || effectiveModifier === undefined || !Number.isInteger(effectiveModifier) || effectiveModifier < -5 || effectiveModifier > 5} onClick={roll}>{rolling ? 'Rolling…' : pendingCheck ? 'Roll and resolve check' : 'Roll and continue story'}</Button>
    </div> : <p className="text-sm text-text-muted">Add a move in the world’s Story Rules tab first.</p>}
  </Modal>
}
