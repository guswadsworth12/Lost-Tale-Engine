import { useEffect, useState } from 'react'
import { ArrowLeft, Plus, Sparkles, Trash2 } from 'lucide-react'
import { charactersApi, chatsApi, messagesApi, worldsApi } from '@/lib/api/client'
import { useChatBackendClient } from '@/lib/hooks/useChatBackendClient'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { createChat } from '@/lib/chat/createChat'
import { CAMPAIGN_PRESETS, campaignStats } from '@/lib/world/campaign'
import { WORLD_TEMPLATES } from '@/lib/world/worldTemplates'
import { draftRpFromBrief, EMPTY_RP_DRAFT, rpCharacterInput, rpDraftError, rpWorldInput, type RpCastDraft, type RpDraft } from '@/lib/assistant/rpBuilder'
import { Button } from '@/components/ui/Button'
import { NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Field'

const DRAFT_KEY = 'writers-room-rp-draft-v1'
const CHECKPOINT_KEY = 'writers-room-rp-checkpoint-v1'
const STEPS = ['Idea', 'World', 'Lore', 'Cast', 'Rules & opening', 'Review'] as const

interface Checkpoint {
  worldId?: string
  playerId?: string
  castIds: Record<number, string>
  chatId?: string
}

function savedDraft(): RpDraft {
  try {
    const value = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Partial<RpDraft> | null
    return value && typeof value === 'object' && Array.isArray(value.cast) && Array.isArray(value.lore)
      ? { ...EMPTY_RP_DRAFT, ...value }
      : EMPTY_RP_DRAFT
  } catch { return EMPTY_RP_DRAFT }
}

function savedCheckpoint(): Checkpoint {
  try {
    const value = JSON.parse(localStorage.getItem(CHECKPOINT_KEY) ?? 'null') as Checkpoint | null
    return value && typeof value === 'object' ? { ...value, castIds: value.castIds ?? {} } : { castIds: {} }
  } catch { return { castIds: {} } }
}

function CastFields({ value, onChange }: { value: RpCastDraft; onChange: (next: RpCastDraft) => void }) {
  const field = (key: keyof RpCastDraft, text: string) => onChange({ ...value, [key]: text })
  return <>
    <TextField label="Name" value={value.name} onChange={(e) => field('name', e.target.value)} maxLength={100} />
    <TextAreaField label="Who are they?" value={value.description} onChange={(e) => field('description', e.target.value)} rows={3} hint="Role, background, motive, and connections to the other characters." />
    <TextAreaField label="How do they act and speak?" value={value.personality} onChange={(e) => field('personality', e.target.value)} rows={2} />
  </>
}

export function GuidedRpBuilder({ onClose, onCreated, conversationBrief }: { onClose: () => void; onCreated: (chatId: string) => void; conversationBrief?: string }) {
  const client = useChatBackendClient()
  const setActivePlayerCharacterId = useSettingsStore((s) => s.setActivePlayerCharacterId)
  const [draft, setDraft] = useState(savedDraft)
  const [checkpoint, setCheckpoint] = useState<Checkpoint>(savedCheckpoint)
  const [step, setStep] = useState(0)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)) }, [draft])
  const update = (patch: Partial<RpDraft>) => { setDraft((current) => ({ ...current, ...patch })); setError('') }
  const remember = (next: Checkpoint) => { setCheckpoint(next); localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(next)) }

  const suggest = async () => {
    if (!draft.brief.trim() || generating || checkpoint.worldId) return
    setGenerating(true)
    setError('')
    try { setDraft(await draftRpFromBrief(client, draft)) }
    catch (cause) { setError(errorMessage(cause)) }
    finally { setGenerating(false) }
  }

  const goNext = () => {
    if (step === 1 && (!draft.title.trim() || !draft.description.trim())) return setError('Give the world a name and description before continuing.')
    if (step === 3 && !draft.cast.some((person) => person.name.trim())) return setError('Add at least one character who can speak in the story.')
    if (step === 4) {
      const invalid = rpDraftError(draft)
      if (invalid) return setError(invalid)
    }
    setError('')
    setStep((current) => Math.min(current + 1, STEPS.length - 1))
  }

  const create = async () => {
    if (saving) return
    const invalid = rpDraftError(draft)
    if (invalid) return setError(invalid)
    setSaving(true)
    setError('')
    let progress = { ...checkpoint, castIds: { ...checkpoint.castIds } }
    try {
      let world = progress.worldId ? await worldsApi.get(progress.worldId) : undefined
      if (!world) {
        world = await worldsApi.create(rpWorldInput(draft))
        progress = { ...progress, worldId: world.id }
        remember(progress)
      } else {
        world = await worldsApi.update(world.id, rpWorldInput(draft))
      }

      const playerInput = rpCharacterInput(draft.player, world.id, draft, true)
      let player = progress.playerId ? await charactersApi.get(progress.playerId) : undefined
      if (!player) {
        player = await charactersApi.create(playerInput)
        progress = { ...progress, playerId: player.id }
        remember(progress)
      } else player = await charactersApi.update(player.id, playerInput)

      const cast = []
      for (const [index, person] of draft.cast.entries()) {
        if (!person.name.trim()) continue
        const input = rpCharacterInput(person, world.id, draft, false, index === 0)
        let character = progress.castIds[index] ? await charactersApi.get(progress.castIds[index]) : undefined
        if (!character) {
          character = await charactersApi.create(input)
          progress = { ...progress, castIds: { ...progress.castIds, [index]: character.id } }
          remember(progress)
        } else character = await charactersApi.update(character.id, input)
        cast.push(character)
      }
      if (!cast.length) throw new Error('Add at least one story character before starting.')

      let chat = progress.chatId ? await chatsApi.get(progress.chatId) : undefined
      if (!chat) {
        chat = await createChat({
          character: cast[0], world, player, participantIds: cast.slice(1).map((person) => person.id),
          summary: draft.brief.trim() || draft.description.trim(), greetingIndex: -1, mode: draft.template,
        })
        progress = { ...progress, chatId: chat.id }
        remember(progress)
      }
      const messages = await messagesApi.listByChat(chat.id)
      if (!messages.length) await messagesApi.create({ chatId: chat.id, role: 'char', name: cast[0].card.name, text: draft.opening.trim() })
      await chatsApi.update(chat.id, { title: draft.title.trim() })
      setActivePlayerCharacterId(player.id)
      localStorage.removeItem(DRAFT_KEY)
      localStorage.removeItem(CHECKPOINT_KEY)
      toastSuccess(`Created ${draft.title.trim()} and opened its first scene.`)
      onCreated(chat.id)
    } catch (cause) {
      const message = errorMessage(cause)
      setError(`Setup stopped: ${message}. Your draft and completed saves are kept; try again.`)
      toastError(message)
    } finally { setSaving(false) }
  }

  const preset = CAMPAIGN_PRESETS.find((entry) => entry.id === draft.ruleset)
  const setCast = (index: number, person: RpCastDraft) => update({ cast: draft.cast.map((entry, i) => i === index ? person : entry) })
  const setLore = (index: number, patch: Partial<RpDraft['lore'][number]>) => update({ lore: draft.lore.map((entry, i) => i === index ? { ...entry, ...patch } : entry) })

  return <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-bg">
    <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-7">
      <Button variant="ghost" onClick={onClose} aria-label="Back to Writer's Room"><ArrowLeft size={17} /></Button>
      <div className="min-w-0 flex-1">
        <h1 className="font-display text-lg font-semibold text-text">Build a roleplay</h1>
        <p className="text-xs text-text-muted">A guided draft for your world, lore, cast, rules, and first scene. Saved on this device until you create it.</p>
      </div>
    </header>
    <nav className="flex shrink-0 overflow-x-auto border-b border-border px-4 sm:px-7" aria-label="Roleplay setup steps">
      {STEPS.map((label, index) => <button key={label} type="button" onClick={() => setStep(index)}
        aria-current={index === step ? 'step' : undefined}
        className={`shrink-0 border-b-2 px-3 py-3 text-xs ${index === step ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text'}`}>
        {index + 1}. {label}
      </button>)}
    </nav>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-7">
      <div className="mx-auto max-w-2xl space-y-4">
        {step === 0 && <>
          <h2 className="font-display text-xl text-text">What do you want to play?</h2>
          <p className="text-sm text-text-muted">Describe the premise, tone, and the kind of choices you want to face. The assistant can suggest a draft, or you can write every field yourself.</p>
          <TextAreaField label="Your idea" value={draft.brief} onChange={(e) => update({ brief: e.target.value })} rows={6} placeholder="A coastal city is losing its memories each night. I play an archivist whose closest friend knows why…" />
          {conversationBrief && <Button onClick={() => update({ brief: conversationBrief })}>Use this conversation as the idea</Button>}
          <SelectField label="Story style" value={draft.template} onChange={(e) => update({ template: e.target.value as RpDraft['template'] })}>
            {WORLD_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
          </SelectField>
          <Button variant="primary" onClick={() => void suggest()} disabled={!draft.brief.trim() || generating || Boolean(checkpoint.worldId)} className="inline-flex items-center gap-2">
            <Sparkles size={15} /> {generating ? 'Drafting…' : 'Suggest world, lore, cast & opening'}
          </Button>
          <p className="text-xs text-text-muted">Suggestions replace the current fields on the next steps. Nothing is saved to your library until Review.</p>
        </>}
        {step === 1 && <>
          <h2 className="font-display text-xl text-text">World</h2>
          <p className="text-sm text-text-muted">Give the GM a setting and the truths it should keep consistent.</p>
          <TextField label="World and story name" value={draft.title} onChange={(e) => update({ title: e.target.value })} maxLength={100} />
          <TextAreaField label="Setting, tone, and central conflict" value={draft.description} onChange={(e) => update({ description: e.target.value })} rows={6} />
          <TextAreaField label="World rules and boundaries" value={draft.rules} onChange={(e) => update({ rules: e.target.value })} rows={4} hint="Facts such as how magic works, what technology exists, or what the story should avoid. Dice rules are chosen later." />
          <TextAreaField label="GM only notes" value={draft.gmNotes} onChange={(e) => update({ gmNotes: e.target.value })} rows={3} hint="Secrets and future reveals. These stay out of character prompts." />
        </>}
        {step === 2 && <>
          <h2 className="font-display text-xl text-text">Lore</h2>
          <p className="text-sm text-text-muted">Add places, factions, history, or other public facts the cast should know. Keep surprises in GM only notes.</p>
          {draft.lore.map((entry, index) => <section key={index} className="rounded-xl border border-border bg-bg-elevated p-4">
            <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-medium">Lore entry {index + 1}</h3><Button variant="ghost" onClick={() => update({ lore: draft.lore.filter((_, i) => i !== index) })} aria-label={`Remove lore entry ${index + 1}`}><Trash2 size={15} /></Button></div>
            <TextField label="Name or keyword" value={entry.name} onChange={(e) => setLore(index, { name: e.target.value })} />
            <TextAreaField label="What is true about it?" value={entry.detail} onChange={(e) => setLore(index, { detail: e.target.value })} rows={3} />
          </section>)}
          <Button onClick={() => update({ lore: [...draft.lore, { name: '', detail: '' }] })}><Plus size={14} className="mr-1 inline" /> Add lore</Button>
        </>}
        {step === 3 && <>
          <h2 className="font-display text-xl text-text">Cast</h2>
          <p className="text-sm text-text-muted">The first story character opens the scene. Add others who can speak, and describe who you play.</p>
          <section className="rounded-xl border border-border bg-bg-elevated p-4"><h3 className="mb-3 font-medium text-text">Who you play</h3><CastFields value={draft.player} onChange={(player) => update({ player })} /></section>
          {draft.cast.map((person, index) => <section key={index} className="rounded-xl border border-border bg-bg-elevated p-4">
            <div className="mb-3 flex items-center justify-between"><h3 className="font-medium text-text">{index === 0 ? 'Opening character' : `Story character ${index + 1}`}</h3><Button variant="ghost" disabled={Boolean(checkpoint.worldId)} onClick={() => update({ cast: draft.cast.filter((_, i) => i !== index) })} aria-label={`Remove character ${index + 1}`}><Trash2 size={15} /></Button></div>
            <CastFields value={person} onChange={(value) => setCast(index, value)} />
          </section>)}
          <Button disabled={Boolean(checkpoint.worldId)} onClick={() => update({ cast: [...draft.cast, { name: '', description: '', personality: '' }] })}><Plus size={14} className="mr-1 inline" /> Add character</Button>
        </>}
        {step === 4 && <>
          <h2 className="font-display text-xl text-text">Rules & opening</h2>
          <p className="text-sm text-text-muted">Choose a check system if you want dice. You can customize its stats and moves in Worlds, and the player sheet in Cast, after creating the story.</p>
          <SelectField label="Checks" value={draft.ruleset} onChange={(e) => update({ ruleset: e.target.value, sheetStats: {} })}>
            <option value="">Narrative only · no dice checks</option>
            {CAMPAIGN_PRESETS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
          </SelectField>
          {preset && <div className="rounded-xl border border-border bg-bg-elevated p-4">
            <h3 className="mb-2 text-sm font-medium text-text">{draft.player.name || 'Player'}'s starting sheet</h3>
            <p className="mb-3 text-xs text-text-muted">These values become the player character's saved sheet for this world. Checks use them instead of a typed modifier.</p>
            <div className="grid gap-x-4 sm:grid-cols-2">{campaignStats(preset.campaign).map((stat) => {
              const fallback = stat.valueMode === 'ability' || stat.valueMode === 'target' ? 10 : 0
              return <NumberField key={stat.id} label={stat.name} value={draft.sheetStats[stat.id] ?? fallback}
                onChange={(e) => update({ sheetStats: { ...draft.sheetStats, [stat.id]: Number(e.target.value) } })}
                min={stat.valueMode === 'ability' ? 1 : stat.valueMode === 'target' ? 0 : preset.campaign.resolver === 'pbta' ? -5 : -100}
                max={stat.valueMode === 'ability' ? 30 : preset.campaign.resolver === 'pbta' ? 5 : 100} step={1} />
            })}</div>
          </div>}
          <TextAreaField label="First scene" value={draft.opening} onChange={(e) => update({ opening: e.target.value })} rows={7} hint="Write from the opening character's point of view. End with something you can respond to." />
        </>}
        {step === 5 && <>
          <h2 className="font-display text-xl text-text">Review your roleplay</h2>
          <p className="text-sm text-text-muted">Creating saves a world, its lore, your player character, the cast, and the first playable scene. You can edit all of them afterward.</p>
          <div className="space-y-3 rounded-xl border border-border bg-bg-elevated p-5 text-sm">
            <p><strong>World:</strong> {draft.title || 'Untitled'} · {WORLD_TEMPLATES.find((entry) => entry.id === draft.template)?.label}</p>
            <p className="whitespace-pre-wrap text-text-muted">{draft.description || 'No description yet'}</p>
            <p><strong>Lore:</strong> {draft.lore.filter((entry) => entry.name && entry.detail).map((entry) => entry.name).join(', ') || 'None yet'}</p>
            <p><strong>You play:</strong> {draft.player.name || 'You'}</p>
            <p><strong>Cast:</strong> {draft.cast.filter((person) => person.name.trim()).map((person) => person.name).join(', ') || 'No characters yet'}</p>
            <p><strong>Checks:</strong> {preset?.label ?? 'Narrative only'}</p>
            <p><strong>Opening:</strong> {draft.opening.trim() || 'No opening yet'}</p>
          </div>
        </>}
        {error && <p role="alert" className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      </div>
    </div>
    <footer className="flex shrink-0 justify-between gap-2 border-t border-border bg-bg-elevated/70 px-4 py-3 sm:px-7">
      <Button variant="ghost" onClick={() => step === 0 ? onClose() : setStep(step - 1)}>{step === 0 ? 'Back to Writer’s Room' : 'Back'}</Button>
      {step < STEPS.length - 1
        ? <Button variant="primary" onClick={goNext}>Continue</Button>
        : <Button variant="primary" onClick={() => void create()} disabled={saving || !draft.title.trim() || !draft.description.trim() || !draft.cast.some((person) => person.name.trim()) || !draft.opening.trim()}>{saving ? 'Creating…' : 'Create & start story'}</Button>}
    </footer>
  </div>
}
