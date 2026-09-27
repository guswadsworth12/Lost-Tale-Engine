import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { NumberField, SelectField, TextAreaField } from '@/components/ui/Field'
import { rollPbtaMove, type CampaignConfig, type PbtaRoll } from '@/lib/world/campaign'

export function CampaignMovePanel({ campaign, onClose, onSubmit }: {
  campaign: CampaignConfig
  onClose: () => void
  /** The rolled result and the declared action; the chat decides how to record and narrate them. */
  onSubmit: (roll: PbtaRoll, action: string) => void
}) {
  const [moveId, setMoveId] = useState(campaign.moves[0]?.id ?? '')
  const [modifier, setModifier] = useState(0)
  const [action, setAction] = useState('')
  const move = campaign.moves.find((entry) => entry.id === moveId)
  const roll = () => {
    if (!move || !Number.isInteger(modifier) || modifier < -5 || modifier > 5) return
    onSubmit(rollPbtaMove(move, modifier), action.trim())
    onClose()
  }
  return <Modal title="Resolve a campaign move" description="Roll 2d6 plus a modifier. The result is saved as a story turn and guides the next reply." onClose={onClose} size="lg">
    {move ? <div className="space-y-3">
      <SelectField label="Move" value={moveId} onChange={(event) => setMoveId(event.target.value)}>
        {campaign.moves.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </SelectField>
      <p className="text-xs text-text-muted">When {move.trigger}</p>
      <TextAreaField label="What are you doing?" value={action} onChange={(event) => setAction(event.target.value)} rows={3} />
      <NumberField label={`${move.stat} modifier`} min={-5} max={5} step={1} value={modifier} onChange={(event) => setModifier(Number(event.target.value))} hint="For this playtest, enter the character's modifier here. Character sheets come next." />
      <Button variant="primary" disabled={!action.trim() || !Number.isInteger(modifier) || modifier < -5 || modifier > 5} onClick={roll}>Roll and continue story</Button>
    </div> : <p className="text-sm text-text-muted">Add a move in the world’s Campaign tab first.</p>}
  </Modal>
}
