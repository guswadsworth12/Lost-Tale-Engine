import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { NumberField, SelectField, TextAreaField } from '@/components/ui/Field'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import type { CampaignConfig } from '@/lib/world/campaign'

export function CampaignMovePanel({ campaign, onClose, onSubmit, pendingCheck }: {
  campaign: CampaignConfig
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
  const roll = async () => {
    if (!move || rolling || !Number.isInteger(modifier) || modifier < -5 || modifier > 5) return
    setRolling(true)
    try {
      await onSubmit(move.id, modifier, action.trim(), messageId)
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
      <NumberField label={`${move.stat} modifier`} min={-5} max={5} step={1} value={modifier} disabled={rolling} onChange={(event) => setModifier(Number(event.target.value))} hint="For this playtest, enter the character's modifier here. Character sheets come next." />
      <Button variant="primary" disabled={rolling || !action.trim() || !Number.isInteger(modifier) || modifier < -5 || modifier > 5} onClick={roll}>{rolling ? 'Rolling…' : pendingCheck ? 'Roll and resolve check' : 'Roll and continue story'}</Button>
    </div> : <p className="text-sm text-text-muted">Add a move in the world’s Campaign tab first.</p>}
  </Modal>
}
