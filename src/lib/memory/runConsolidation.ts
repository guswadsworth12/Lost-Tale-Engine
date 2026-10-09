import { estimateTokens } from '../tokenEstimate'
import { consolidationApi } from '../api/client'
import { createTextClient, resolveJob, type ServiceSettings } from '../api/services'
import { generateWithTimeout, type AssistShaping } from '../api/generateWithTimeout'
import type { SecretFlags } from '../accounts/secrets'
import type { WorldCard } from '../types'
import { modulesForWorld } from '../world/worldTemplates'
/** One call, with no automatic model fallback. Both automatic and manual runs use the server cap. */
export async function runConsolidation(world: WorldCard | undefined, chatId: string, characterId: string, settings: ServiceSettings, secrets: SecretFlags, shaping?: AssistShaping, contextLength = 32768): Promise<boolean> {
  const model = resolveJob('memory', settings)
  if (!modulesForWorld(world).deepMemory || !world?.memoryConsolidation?.enabled || !model) return false
  const prepared = await consolidationApi.prepare(chatId, characterId)
  if (!prepared) return false
  try {
    if (estimateTokens(prepared.prompt) + 700 + (shaping?.reasoningReserve ?? 0) > contextLength) throw new Error('These memory clusters exceed the selected context size; nothing was changed.')
    const raw = await generateWithTimeout(createTextClient(model.service, model.model, secrets), {
      prompt: prepared.prompt, max_length: 700, max_context_length: contextLength, temperature: 0.2, top_p: 1, top_k: 0, min_p: 0, typical: 1, tfs: 1, rep_pen: 1.1, rep_pen_range: 1024, rep_pen_slope: 0.7,
    }, 'Consolidate memories', undefined, shaping)
    await consolidationApi.commit(chatId, prepared.id, raw)
    return true
  } catch (error) {
    await consolidationApi.cancel(chatId, prepared.id).catch(() => {})
    throw error
  }
}
