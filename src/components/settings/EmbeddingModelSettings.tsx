import { useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { embeddingConnection } from '@/lib/api/embeddings'
import { normalizeVector } from '@/lib/memory/vector'
import { Button } from '@/components/ui/Button'
import { ModelPicker } from './ModelPicker'

/** Optional model choice, separate from every text-model job. */
export function EmbeddingModelSettings() {
  const services = useSettingsStore((s) => s.services)
  const embeddingModel = useSettingsStore((s) => s.embeddingModel)
  const setModelChoice = useSettingsStore((s) => s.setModelChoice)
  const { saved: secrets } = useSecretStatus()
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState('')
  const connection = embeddingConnection({ services, embeddingModel }, secrets)
  const test = async () => {
    if (!connection) return
    setTesting(true)
    setResult('')
    try {
      const [vector] = await connection.embed(['A boat crossed the river.'])
      setResult(`Works · ${normalizeVector(vector).length} dimensions.`)
    } catch { setResult('Could not embed the test sentence. Check the service and model.') }
    finally { setTesting(false) }
  }
  return <div className="space-y-1.5">
    <ModelPicker capability="embeddings" label="Embedding model" value={embeddingModel} onChange={(c) => { setModelChoice('embeddings', c); setResult('') }} emptyLabel="None" />
    <p className="text-xs text-text-muted">Optional recall by meaning in worlds with Deep Memory on. A cloud service receives memory text and recent conversation. Choose a local service to keep these on your machine.</p>
    {connection && <Button disabled={testing} onClick={test}>{testing ? 'Testing…' : 'Test it'}</Button>}
    {result && <p role="status" className="text-xs text-text-muted">{result}</p>}
  </div>
}
