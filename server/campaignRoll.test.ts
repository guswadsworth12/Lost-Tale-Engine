import { describe, expect, it } from 'vitest'
import { resolvePbtaRoll, STARTER_PBTA_CAMPAIGN } from '../src/lib/world/campaign.ts'
import { createCampaignRoll, requiredRollText, sameRollRequest } from './campaignRoll.ts'

const move = STARTER_PBTA_CAMPAIGN.moves[0]
const roll = () => ({ ...resolvePbtaRoll(move, -1, [3, 4]), id: 'roll-1', action: 'Cross the bridge', createdAt: 1 })

describe('server-owned campaign rolls', () => {
  it('constructs a deterministic miss from injected dice', () => {
    expect(createCampaignRoll(move, -1, [3, 4], ' Cross the bridge ', 'roll-2', 2)).toEqual({
      ...resolvePbtaRoll(move, -1, [3, 4]), id: 'roll-2', action: 'Cross the bridge', createdAt: 2,
    })
    expect(() => createCampaignRoll(move, 0, [0, 6], 'Act', 'roll-3', 3)).toThrow()
    expect(() => createCampaignRoll(move, 6, [3, 4], 'Act', 'roll-3', 3)).toThrow()
    expect(() => createCampaignRoll(move, 0, [3, 4], ' ', 'roll-3', 3)).toThrow()
    expect(() => requiredRollText('x'.repeat(501), 'Action', 500)).toThrow()
  })

  it('recognizes an exact idempotent retry and rejects a conflicting use of the same message id', () => {
    const request = { chatId: 'chat-1', moveId: move.id, modifier: -1, action: 'Cross the bridge', text: 'I cross the bridge.' }
    const existing = { chatId: 'chat-1', role: 'user', text: request.text, campaignRoll: roll() }
    expect(sameRollRequest(existing, request)).toBe(true)
    expect(sameRollRequest(existing, { ...request, modifier: 1 })).toBe(false)
    expect(sameRollRequest(existing, { ...request, chatId: 'chat-2' })).toBe(false)
    expect(sameRollRequest({ ...existing, campaignRoll: undefined }, request)).toBe(false)
  })
})
