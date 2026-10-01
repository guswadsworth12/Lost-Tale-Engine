import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { SERVICE_KINDS, offers, serviceSecret, type Capability, type ModelChoice, type Service } from '@/lib/api/services'
import { loadServiceModels } from '@/lib/api/serviceModels'

const selectClass = 'w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:py-2 sm:text-sm'

/** Kinds whose model list can be asked for. */
const LISTABLE = new Set(['openai', 'gemini', 'openmayhem', 'openai-compatible', 'a1111', 'comfyui', 'swarmui'])

/** The models a service lists for a capability: its loaded list, else the suggested ones. */
export function modelsOf(service: Service, capability: Capability): string[] {
  const loaded = service.models?.[capability]
  return loaded?.length ? loaded : SERVICE_KINDS[service.kind].models?.[capability] ?? []
}

// Each service's list is asked for once a session, by whichever picker shows it first.
const asked = new Set<string>()

/**
 * Loads the model lists of `services` that don't have one yet, quietly: the pickers fill in by
 * themselves. A service whose key isn't saved yet is left until it is.
 */
function useModelLists(services: Service[]) {
  const { saved: secrets } = useSecretStatus()
  const updateService = useSettingsStore((s) => s.updateService)
  useEffect(() => {
    for (const service of services) {
      const secret = serviceSecret(service)
      const ready = SERVICE_KINDS[service.kind].key !== 'required' || (!!secret && secrets[secret])
      const key = `${service.id}|${service.baseUrl ?? ''}`
      if (!LISTABLE.has(service.kind) || service.models || !ready || asked.has(key)) continue
      asked.add(key)
      loadServiceModels(service, secrets).then((models) => {
        if (Object.values(models).some((list) => list?.length)) updateService(service.id, { models })
      }).catch(() => {})
    }
  }, [services, secrets, updateService])
}

/**
 * Two dropdowns: the service, then one of its models. The chosen model is always one of the options;
 * only a service that can't list its models (KoboldCpp, say) offers typing a name instead.
 * `emptyLabel` adds a service choice meaning "none of my own" (the default it falls back to).
 */
export function ModelPicker({ capability, value, onChange, emptyLabel, label, id }: {
  capability: Capability
  value: ModelChoice | null | undefined
  onChange: (choice: ModelChoice | null) => void
  emptyLabel?: string
  label?: string
  id?: string
}) {
  const services = useSettingsStore((s) => s.services).filter((service) => offers(service, capability))
  useModelLists(services)
  const [typing, setTyping] = useState(false)
  const current = value && services.some((s) => s.id === value.serviceId) ? value : null
  const service = services.find((s) => s.id === current?.serviceId)

  if (!services.length) {
    return <p className="text-xs text-text-muted">Add a service that offers {capability} above first.</p>
  }

  // The chosen service's models, plus the chosen model if its list doesn't have it.
  const listed = service ? modelsOf(service, capability) : []
  const models = current?.model && !listed.includes(current.model) ? [current.model, ...listed] : listed
  const canType = !!service && !service.models?.[capability]?.length && !LISTABLE.has(service.kind)
  const modelValue = typing ? '__type' : current?.model && models.includes(current.model) ? current.model : ''

  return (
    <div className="space-y-1.5">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <select id={id} aria-label={label ? `${label}: service` : 'Service'} className={selectClass} value={service?.id ?? ''} onChange={(e) => {
          setTyping(false)
          const next = services.find((s) => s.id === e.target.value)
          if (!next) { onChange(null); return }
          // A new service starts on its first model, or none to pick for one that can't list any.
          onChange({ serviceId: next.id, model: modelsOf(next, capability)[0] ?? '' })
        }}>
          {emptyLabel !== undefined ? <option value="">{emptyLabel}</option> : !service && <option value="" disabled>Choose a service</option>}
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {service && (
          <select aria-label={label ? `${label}: model` : 'Model'} className={selectClass} value={modelValue} onChange={(e) => {
            if (e.target.value === '__type') { setTyping(true); onChange({ serviceId: service.id, model: '' }); return }
            setTyping(false)
            onChange({ serviceId: service.id, model: e.target.value })
          }}>
            {models.length === 0
              ? <option value="">{service.kind === 'koboldcpp' ? 'The loaded model' : 'Its default model'}</option>
              : !modelValue && <option value="" disabled>Choose a model</option>}
            {models.map((model) => <option key={model} value={model}>{model}</option>)}
            {canType && <option value="__type">Type a model name…</option>}
          </select>
        )}
      </div>
      {typing && service && (
        <input aria-label="Model name" className={selectClass} placeholder="The model's name"
          value={current?.model ?? ''} onChange={(e) => onChange({ serviceId: service.id, model: e.target.value })} />
      )}
    </div>
  )
}
