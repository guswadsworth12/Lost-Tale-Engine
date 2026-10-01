import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { forgetSecret, useSecretStatus } from '@/lib/accounts/secrets'
import {
  KNOWN_COMPATIBLE, MODEL_JOBS, SERVICE_KINDS, newServiceId, offers, serviceSecret, type Capability, type Service, type ServiceKind,
} from '@/lib/api/services'
import { loadServiceModels } from '@/lib/api/serviceModels'
import { useConnectionStatus } from '@/lib/hooks/useConnectionStatus'
import { BUILTIN_INSTRUCT_TEMPLATES } from '@/lib/prompt/instructTemplates'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { errorMessage, toastSuccess } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { STATUS_DOT, STATUS_LABEL } from './HostedConnectionStatus'
import { ModelPicker } from './ModelPicker'
import { SecretKeyField } from './SecretKeyField'

const CAPABILITY_LABEL: Record<Capability, string> = { text: 'Text', images: 'Images', voice: 'Voice' }
const BADGE: Record<Capability, string> = { text: 'bg-accent/10 text-accent', images: 'bg-success/10 text-success', voice: 'bg-warning/15 text-text' }
const selectClass = 'w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:py-2 sm:text-sm'

/** What "Add a service" offers, grouped; an OpenAI-compatible pick fills in its address. */
const ADD_GROUPS: { label: string; choices: { id: string; label: string; kind: ServiceKind; baseUrl?: string }[] }[] = [
  { label: 'Hosted', choices: [
    { id: 'openai', label: 'OpenAI', kind: 'openai' },
    { id: 'gemini', label: 'Google Gemini', kind: 'gemini' },
    { id: 'openmayhem', label: 'OpenMayhem', kind: 'openmayhem' },
    { id: 'novelai', label: 'NovelAI', kind: 'novelai' },
    ...KNOWN_COMPATIBLE.filter((k) => !k.label.includes('local')).map((k) => ({ id: k.label, label: k.label, kind: 'openai-compatible' as const, baseUrl: k.baseUrl })),
  ] },
  { label: 'On your machine', choices: [
    { id: 'koboldcpp', label: 'KoboldCpp', kind: 'koboldcpp' },
    ...KNOWN_COMPATIBLE.filter((k) => k.label.includes('local')).map((k) => ({ id: k.label, label: k.label, kind: 'openai-compatible' as const, baseUrl: k.baseUrl })),
    { id: 'a1111', label: 'Automatic1111 / Forge', kind: 'a1111' },
    { id: 'comfyui', label: 'ComfyUI', kind: 'comfyui' },
    { id: 'swarmui', label: 'SwarmUI', kind: 'swarmui' },
    { id: 'luxtts', label: 'LuxTTS (your voice server)', kind: 'luxtts' },
  ] },
  { label: 'Voice', choices: [
    { id: 'elevenlabs', label: 'ElevenLabs', kind: 'elevenlabs' },
    { id: 'azure', label: 'Microsoft / Azure Speech', kind: 'azure' },
  ] },
  { label: 'Other', choices: [{ id: 'compatible', label: 'Another OpenAI-compatible service', kind: 'openai-compatible' }] },
]

/**
 * Settings → Models and services. Each account or server is added once (its key and address live
 * here and nowhere else); models for text, images and voice are then picked from what they offer,
 * with a different text model for a job when wanted.
 */
export function ModelsAndServicesSettings() {
  const services = useSettingsStore((s) => s.services)
  const addService = useSettingsStore((s) => s.addService)
  const [open, setOpen] = useState<string | null>(null)
  const [adding, setAdding] = useState('')

  const add = (choiceId: string) => {
    const choice = ADD_GROUPS.flatMap((g) => g.choices).find((c) => c.id === choiceId)
    if (!choice) return
    const info = SERVICE_KINDS[choice.kind]
    const id = newServiceId(choice.label, services.map((s) => s.id))
    addService({ id, name: choice.label, kind: choice.kind, ...(info.address ? { baseUrl: choice.baseUrl ?? info.address.default } : {}) })
    setOpen(id)
    setAdding('')
  }

  return (
    <SettingsPage>
      <Section title="Services" description="Each account or server you use, once. Its key and address live here and nowhere else." surface="bare">
        <div className="mb-3 divide-y divide-border rounded-xl border border-border">
          {services.length === 0 && <p className="p-3 text-sm text-text-muted">No services yet. Add the one you use for text first.</p>}
          {services.map((service) => (
            <ServiceRow key={service.id} service={service} open={open === service.id} onToggle={() => setOpen(open === service.id ? null : service.id)} />
          ))}
        </div>
        <select aria-label="Add a service" className={selectClass} value={adding} onChange={(e) => add(e.target.value)}>
          <option value="">Add a service…</option>
          {ADD_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </optgroup>
          ))}
        </select>
      </Section>
      <ModelsSection />
    </SettingsPage>
  )
}

/** One service: a summary line, and its fields when opened. */
function ServiceRow({ service, open, onToggle }: { service: Service; open: boolean; onToggle: () => void }) {
  const { saved: secrets } = useSecretStatus()
  const updateService = useSettingsStore((s) => s.updateService)
  const removeService = useSettingsStore((s) => s.removeService)
  const info = SERVICE_KINDS[service.kind]
  const secret = serviceSecret(service)
  const keyState = info.key === 'none' ? null : secret && secrets[secret] ? 'Key saved' : info.key === 'required' ? 'Needs a key' : null
  const [address, setAddress] = useState(service.baseUrl ?? '')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null)

  // A new address is another service: its own key must not be sent there.
  const commitAddress = () => {
    const next = address.trim().replace(/\/+$/, '')
    if (next === (service.baseUrl ?? '')) return
    updateService(service.id, { baseUrl: next, models: undefined })
    if (secret && !info.sharedSecret && secrets[secret]) forgetSecret(secret)
  }

  const load = async () => {
    setLoading(true)
    setResult(null)
    try {
      const models = await loadServiceModels({ ...service, baseUrl: address.trim() || service.baseUrl }, secrets)
      updateService(service.id, { models })
      const count = Object.values(models).reduce((n, list) => n + (list?.length ?? 0), 0)
      setResult({ ok: true, detail: count ? `Works · ${count} models listed` : 'Works' })
    } catch (e) {
      setResult({ ok: false, detail: errorMessage(e) })
    } finally {
      setLoading(false)
    }
  }

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Remove ${service.name}?`,
      body: 'Any model picked from it is cleared. Its own key is deleted; a key shared with other parts of the app is kept.',
      confirmLabel: 'Remove',
      tone: 'danger',
    })
    if (!ok) return
    removeService(service.id)
    if (secret && !info.sharedSecret && secrets[secret]) forgetSecret(secret)
  }

  return (
    <div>
      <button onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 p-3 text-left hover:bg-bg-sunken">
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        <span className="min-w-0 flex-1 truncate text-sm text-text">
          {service.name}
          {service.baseUrl && <span className="ml-1.5 text-xs text-text-muted">{service.baseUrl.replace(/^https?:\/\//, '')}</span>}
        </span>
        {info.offers.map((c) => <span key={c} className={`rounded-md px-1.5 py-0.5 text-[11px] ${BADGE[c]}`}>{CAPABILITY_LABEL[c]}</span>)}
        {keyState && <span className={`text-xs ${keyState === 'Key saved' ? 'text-success' : 'text-warning'}`}>{keyState === 'Key saved' && <Check size={12} className="mr-0.5 inline" aria-hidden="true" />}{keyState}</span>}
      </button>
      {open && (
        <div className="space-y-1 border-t border-border p-3">
          {info.hint && <p className="mb-2 text-xs text-text-muted">{info.hint}</p>}
          <TextField label="Name" value={service.name} maxLength={40} onChange={(e) => updateService(service.id, { name: e.target.value })} />
          {info.address && <TextField label="Address" value={address} onChange={(e) => setAddress(e.target.value)} onBlur={commitAddress}
            placeholder={info.address.default || 'https://…/v1'} hint={info.key !== 'none' ? 'Changing it forgets this service\'s key, so it\'s never sent somewhere else.' : undefined} />}
          {info.username && <TextField label="Username (optional)" value={service.username ?? ''} onChange={(e) => updateService(service.id, { username: e.target.value })} />}
          {info.region && <TextField label="Region" value={service.region ?? ''} placeholder="eastus" onChange={(e) => updateService(service.id, { region: e.target.value })} />}
          {secret && <SecretKeyField name={secret} saved={!!secrets[secret]}
            label={info.username ? 'Password (optional)' : info.key === 'optional' ? 'API key (optional)' : 'API key'}
            hint={info.sharedSecret ? `The one ${info.label} key for this account: text, images and voice all use it.` : 'Saved encrypted to your account, only for this service.'} />}
          {service.kind === 'koboldcpp' && <KoboldStatus baseUrl={service.baseUrl ?? ''} />}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {service.kind !== 'koboldcpp' && service.kind !== 'luxtts' && service.kind !== 'elevenlabs' && service.kind !== 'azure' && service.kind !== 'novelai' && (
              <Button onClick={() => void load()} disabled={loading}>{loading ? 'Checking…' : 'Test and load models'}</Button>
            )}
            {result && <span className={`text-xs ${result.ok ? 'text-success' : 'text-danger'}`}>{result.ok ? '' : 'Not working: '}{result.detail}</span>}
            <button onClick={() => void remove()} className="ml-auto text-xs text-text-muted hover:text-danger">Remove</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** KoboldCpp's live status: reachable, the loaded model, and whether the instruct template matches it. */
function KoboldStatus({ baseUrl }: { baseUrl: string }) {
  const { status, model, version, maxContext, detectedTemplateId } = useConnectionStatus(baseUrl)
  const instructTemplateId = useSettingsStore((s) => s.instructTemplateId)
  const setInstructTemplateId = useSettingsStore((s) => s.setInstructTemplateId)
  const detected = BUILTIN_INSTRUCT_TEMPLATES.find((t) => t.id === detectedTemplateId)
  const mismatch = detected && BUILTIN_INSTRUCT_TEMPLATES.some((t) => t.id === instructTemplateId) && detectedTemplateId !== instructTemplateId ? detected : undefined
  return (
    <div className="rounded-xl bg-bg-sunken p-3 text-xs">
      <div className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} /><span className="text-text">{STATUS_LABEL[status]}</span></div>
      {model && <div className="mt-1 text-text-muted">Model: {model}{version ? ` · KoboldCpp ${version}` : ''}</div>}
      {maxContext !== null && <div className="text-text-muted">Context: {maxContext.toLocaleString()} tokens</div>}
      {mismatch && (
        <div className="mt-2 text-text">
          This model's chat template looks like <strong>{mismatch.name}</strong>, but the active instruct template differs. That mismatch is the usual cause of rambling or a model that never stops.
          <div className="mt-1.5"><Button onClick={() => { setInstructTemplateId(mismatch.id); toastSuccess(`Instruct template set to ${mismatch.name}`) }}>Switch to {mismatch.name}</Button></div>
        </div>
      )}
    </div>
  )
}

/** The Text, Images and Voice models, and any job with a text model of its own. */
function ModelsSection() {
  const textModel = useSettingsStore((s) => s.textModel)
  const imageModel = useSettingsStore((s) => s.imageModel)
  const voiceModel = useSettingsStore((s) => s.voiceModel)
  const setModelChoice = useSettingsStore((s) => s.setModelChoice)
  const modelJobs = useSettingsStore((s) => s.modelJobs)
  const setModelJob = useSettingsStore((s) => s.setModelJob)
  const services = useSettingsStore((s) => s.services)
  const imageQuality = useSettingsStore((s) => s.imageBackendQuality)
  const setImageBackendConfig = useSettingsStore((s) => s.setImageBackendConfig)
  const [showJobs, setShowJobs] = useState(Object.keys(modelJobs).length > 0)
  const [addingJob, setAddingJob] = useState('')
  const overridden = MODEL_JOBS.filter((job) => modelJobs[job.id])
  const imageService = services.find((s) => s.id === imageModel?.serviceId)

  return (
    <Section title="Models" description="Picked from what your services offer. Load a service's list from its row above to see all of its models." surface="bare">
      <div className="grid items-start gap-x-3 gap-y-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
        <span className="pt-2 text-sm text-text-muted">Text</span>
        <ModelPicker capability="text" label="Text model" value={textModel} onChange={(c) => setModelChoice('text', c)} />
        <span className="pt-2 text-sm text-text-muted">Images</span>
        <div className="space-y-1.5">
          <ModelPicker capability="images" label="Image model" value={imageModel} onChange={(c) => setModelChoice('images', c)} emptyLabel="None" />
          {imageService?.kind === 'openai' && (
            <select aria-label="Image quality" className={selectClass} value={imageQuality} onChange={(e) => setImageBackendConfig({ imageBackendQuality: e.target.value })}>
              <option value="">Quality: the model's default</option>
              <option value="low">Quality: low (cheapest)</option>
              <option value="medium">Quality: medium</option>
              <option value="high">Quality: high (costs most)</option>
            </select>
          )}
        </div>
        <span className="pt-2 text-sm text-text-muted">Voice</span>
        <div>
          <ModelPicker capability="voice" label="Voice model" value={voiceModel} onChange={(c) => setModelChoice('voice', c)} emptyLabel="None" />
          <p className="mt-1 text-xs text-text-muted">Which voice speaks is set on the Voice tab.</p>
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <button onClick={() => setShowJobs((v) => !v)} aria-expanded={showJobs} className="flex items-center gap-1.5 text-sm text-text">
          {showJobs ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
          Use a different text model for a job
          {overridden.length > 0 && <span className="text-xs text-text-muted">· {overridden.length} set</span>}
        </button>
        {showJobs && (
          <div className="mt-3 space-y-3">
            <p className="text-xs text-text-muted">Every other job uses the Text model. If a job's model doesn't answer, that call falls back to the Text model and you're told.</p>
            {overridden.map((job) => (
              <div key={job.id} className="grid items-start gap-x-3 gap-y-1 sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
                <span className="pt-2 text-sm text-text" title={job.covers}>{job.label}</span>
                <ModelPicker capability="text" label={`${job.label} model`} value={modelJobs[job.id]} onChange={(c) => setModelJob(job.id, c)} />
                <button onClick={() => setModelJob(job.id, null)} aria-label={`Use the Text model for ${job.label}`} className="rounded-lg p-2 text-text-muted hover:bg-bg-sunken hover:text-text"><X size={14} /></button>
              </div>
            ))}
            {overridden.length < MODEL_JOBS.length && (
              <select aria-label="Add a job" className={selectClass} value={addingJob} onChange={(e) => {
                const job = MODEL_JOBS.find((j) => j.id === e.target.value)
                if (job && textModel) setModelJob(job.id, { ...textModel })
                setAddingJob('')
              }}>
                <option value="">Add a job…</option>
                {MODEL_JOBS.filter((job) => !modelJobs[job.id]).map((job) => <option key={job.id} value={job.id}>{job.label}: {job.covers}</option>)}
              </select>
            )}
          </div>
        )}
      </div>
      {services.some((s) => offers(s, 'text')) && !textModel && <p className="mt-3 text-xs text-warning">Pick a Text model: replies use it.</p>}
    </Section>
  )
}
