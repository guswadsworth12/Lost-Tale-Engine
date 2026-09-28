import { resolveCampaignRoll, resolvePbtaRoll, type CampaignConfig, type PbtaMove } from '../src/lib/world/campaign.ts'
import type { RecordedMove } from '../src/lib/world/gm.ts'

export function requiredRollText(raw: unknown, label: string, max: number): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > max) throw new Error(`${label} must be 1-${max} characters.`)
  return raw.trim()
}

/** Server selects the dice; passing them in keeps this calculation deterministic and testable. */
export function createCampaignRoll(move: PbtaMove, modifier: number, dice: [number, number], action: string, id: string, createdAt: number): RecordedMove {
  if (!Array.isArray(dice) || dice.length !== 2 || !dice.every((die) => Number.isInteger(die) && die >= 1 && die <= 6)) {
    throw new Error('A campaign roll needs two dice between 1 and 6.')
  }
  return { ...resolvePbtaRoll(move, modifier, dice), action: requiredRollText(action, 'Action', 500), id, createdAt }
}

export function createResolvedCampaignRoll(campaign: CampaignConfig, move: PbtaMove, modifier: number, dice: number[], target: number | undefined, rollMode: 'normal' | 'advantage' | 'disadvantage', action: string, id: string, createdAt: number): RecordedMove {
  return { ...resolveCampaignRoll(campaign, move, modifier, dice, target, rollMode), action: requiredRollText(action, 'Action', 500), id, createdAt }
}

export function sameRollRequest(existing: {
  chatId?: unknown; role?: unknown; text?: unknown; campaignRoll?: unknown
}, request: { chatId: string; moveId: string; modifier: number; action: string; text: string; target?: number; rollMode?: 'normal' | 'advantage' | 'disadvantage'; pendingGmMessageId?: string }): boolean {
  const roll = existing.campaignRoll as Partial<RecordedMove> | undefined
  return existing.chatId === request.chatId && existing.role === 'user' && existing.text === request.text
    && roll?.moveId === request.moveId && roll.modifier === request.modifier && roll.action === request.action
    && roll.requestedTarget === request.target && (roll.rollMode ?? 'normal') === (request.rollMode ?? 'normal')
    && roll.pendingGmMessageId === request.pendingGmMessageId
}
