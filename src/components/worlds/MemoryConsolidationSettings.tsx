import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { useModelSettings } from '@/lib/hooks/useModelFor'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { chatsApi, charactersApi, consolidationApi, memoriesApi } from '@/lib/api/client'
import { resolveJob } from '@/lib/api/services'
import { runConsolidation } from '@/lib/memory/runConsolidation'
import { consolidationSettings, type ConsolidationRun } from '@/lib/memory/consolidation'
import type { WorldCard } from '@/lib/types'
import { Button } from '@/components/ui/Button'
import { NumberField, SelectField } from '@/components/ui/Field'
import { toastError, toastSuccess, errorMessage } from '@/lib/store/useToastStore'
function RunDetails({ run }: { run: ConsolidationRun }) {
  const [open, setOpen] = useState(false)
  const memories = useApiQuery('memories', () => open ? memoriesApi.forChat(run.chatId) : Promise.resolve([]), [open, run.chatId]) ?? []
  return <details className="w-full" onToggle={(e) => setOpen(e.currentTarget.open)}><summary className="cursor-pointer">View memories</summary><div className="mt-2 space-y-2">
    <p className="font-medium">Summaries</p>{memories.filter((m) => run.summaryIds.includes(m.id)).map((m) => <p key={m.id}>{m.text}</p>)}
    <p className="font-medium">Originals</p>{memories.filter((m) => run.originalIds.includes(m.id)).map((m) => <p key={m.id}>{m.text}</p>)}
  </div></details>
}
export function MemoryConsolidationSettings({ world, value, onChange }: { world?: WorldCard; value: WorldCard['memoryConsolidation']; onChange: (v: NonNullable<WorldCard['memoryConsolidation']>) => void }) {
  const contextLength = useSettingsStore((s) => s.sampler.max_context_length)
  const settings = consolidationSettings(value), models = useModelSettings(), { saved: secrets } = useSecretStatus()
  const [busy, setBusy] = useState(false), [sceneId, setSceneId] = useState(''), [revision, setRevision] = useState(0)
  const chats = useApiQuery('chats', () => chatsApi.list(), []) ?? []
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const scenes = chats.filter((chat) => characters.find((c) => c.id === chat.characterId)?.worldId === world?.id)
  const runs = useApiQuery('memories', () => world ? consolidationApi.list(world.id) : Promise.resolve([]), [world?.id, revision]) ?? []
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); setRevision((r) => r + 1) } catch (e) { toastError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <div className="mt-3 space-y-3 rounded-lg border border-border p-3">
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.enabled} onChange={(e) => onChange({ ...settings, enabled: e.target.checked })} />Consolidate old memories between sessions</label>
    <p className="text-xs text-text-muted">Off by default. Uses one model call per character to summarize related memories. Originals stay available to other characters and story branches. Failed attempts count toward the daily cap. Save these settings before a manual run.</p>
    <NumberField label="Daily runs per character" value={settings.dailyCap} min={1} max={10} onChange={(e) => onChange({ ...settings, dailyCap: Number(e.target.value) })} />
    {world && <>
      <SelectField label="Scene to consolidate" value={sceneId} onChange={(e) => setSceneId(e.target.value)}><option value="">Choose a scene</option>{scenes.map((c) => <option key={c.id} value={c.id}>{c.title || c.id}</option>)}</SelectField>
      {!resolveJob('memory', models) && <p className="text-xs text-text-muted">Choose a text model in Settings to consolidate memories.</p>}
      <Button variant="secondary" disabled={busy || !settings.enabled || !sceneId || !resolveJob('memory', models)} onClick={() => void act(async () => {
        const fresh = await chatsApi.get(sceneId)
        if (!fresh) return
        let count = 0
        for (const id of new Set(fresh.scene?.presentCharacterIds ?? [fresh.characterId, ...(fresh.participants ?? [])])) if (id !== fresh.playerCharacterId && await runConsolidation(world, fresh.id, id, models, secrets, undefined, contextLength)) count++
        toastSuccess(count ? `Consolidated memories for ${count} character(s).` : 'Nothing to consolidate: check saved settings, model choice, daily cap and related memories.')
      })}>Consolidate now</Button>
      {runs.filter((run) => !run.undoneAt).map((run) => <div key={run.id} className="flex flex-wrap items-center gap-2 text-xs"><span>{new Date(run.at).toLocaleString()}: {run.originalIds.length} memories → {run.summaryIds.length} {run.summaryIds.length === 1 ? 'summary' : 'summaries'} ({characters.find((c) => c.id === run.characterId)?.card.name || 'Character'}, {chats.find((c) => c.id === run.chatId)?.title || 'Untitled scene'})</span><Button variant="secondary" disabled={busy} onClick={() => void act(() => consolidationApi.undo(run))}>Undo</Button><RunDetails run={run} /></div>)}
    </>}
  </div>
}
