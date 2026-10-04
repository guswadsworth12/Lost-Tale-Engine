import { useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Loader2, Play, Sparkles, Volume2 } from 'lucide-react'
import { BrandWordmark } from '@/components/ui/BrandMark'
import { Button } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { InvitePlayers } from '@/components/settings/AdminSettings'
import { ADD_GROUPS, ServiceRow, useAddService } from '@/components/settings/ModelsAndServicesSettings'
import { ModelPicker } from '@/components/settings/ModelPicker'
import { NewChatDialog } from '@/components/chat/NewChatDialog'
import type { ViewId } from '@/components/layout/Sidebar'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, worldsApi } from '@/lib/api/client'
import { blankCharacterData, type Character } from '@/lib/characters/cardSpec'
import type { WorldCard } from '@/lib/types'
import { STARTER_STORY } from '@/lib/setup/starterStory'
import { startStarterStory, type StarterPlayer } from '@/lib/setup/startStarterStory'
import { SERVICE_KINDS, chosen, createTextClient, newServiceId, offers, type Capability } from '@/lib/api/services'
import { synthesizeSpeech } from '@/lib/voice/ttsProviders'
import { errorMessage } from '@/lib/store/useToastStore'
import { startTour } from '@/lib/help/helpStore'
import { shouldOfferIntro, tutorialStore } from '@/lib/help/tutorialState'
import {
  SETUP_STEPS, nextStep, previousStep, resumeStep, stepState, stepsFor, verifiedKey, withSkipped,
  type SetupStepId,
} from '@/lib/setup/setup'
import { useSetupFacts } from './useSetupFacts'

const selectClass = 'w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:py-2 sm:text-sm'

/**
 * The setup wizard (#40): one step at a time, from nothing to a first story. Full-screen on first
 * run (`variant="page"`, in place of the old Welcome screen), or over the app when a step is
 * reopened from the Get set up checklist (`variant="overlay"`). Every step uses the same service
 * rows and model pickers as Settings → Models and services, so nothing is set up twice.
 */
export function SetupWizard({
  variant,
  initialStep,
  onClose,
  onStarted,
  onNavigate,
}: {
  variant: 'page' | 'overlay'
  /** Where to open. Unset: where they left off (`resumeStep`). */
  initialStep?: SetupStepId
  /** Closed without starting a story: put off (first run) or finished from the checklist. */
  onClose: () => void
  /** A story was started from the last step. */
  onStarted: (chatId: string) => void
  onNavigate: (view: ViewId) => void
}) {
  const progress = useSettingsStore((s) => s.setupProgress)
  const setProgress = useSettingsStore((s) => s.setSetupProgress)
  const facts = useSetupFacts()
  const [stepId, setStepId] = useState<SetupStepId>(() => initialStep ?? resumeStep(facts, progress))
  const step = SETUP_STEPS.find((s) => s.id === stepId)!
  const state = stepState(step, facts, progress)
  const listed = stepsFor(facts).filter((s) => s.listed)

  const go = (id: SetupStepId | undefined) => {
    if (!id) return
    if (progress.status === 'new') setProgress({ ...progress, status: 'active' })
    setStepId(id)
  }
  const putOff = () => {
    setProgress({ ...progress, status: progress.status === 'done' ? 'done' : 'dismissed', at: Date.now() })
    onClose()
  }
  const skip = () => {
    setProgress(withSkipped({ ...progress, status: progress.status === 'new' ? 'active' : progress.status }, stepId, true))
    go(nextStep(stepId, facts))
  }
  const finish = (chatId?: string) => {
    setProgress({ ...progress, status: 'done', at: Date.now() })
    if (chatId) onStarted(chatId)
    else onClose()
    // Straight on into the tour: its first-run offer stays hidden during play, which is exactly where
    // finishing with a story lands them. First-run setup happens once per account, but whether the
    // tour was seen is remembered per browser, so a skip by someone else on this device (or an old
    // "Not now") doesn't stop a new account's tour. Reopened from the checklist, it only starts unseen.
    if (variant === 'page' || shouldOfferIntro(tutorialStore.getSnapshot())) startTour()
  }

  const shell = variant === 'overlay'
    ? 'fixed inset-0 z-50 flex flex-col bg-bg'
    : 'flex min-h-0 flex-1 flex-col bg-bg'

  return (
    <div className={shell} role={variant === 'overlay' ? 'dialog' : undefined} aria-modal={variant === 'overlay' ? true : undefined} aria-label="Set up Lost Tales Engine">
      <header className="shrink-0 border-b border-border bg-bg-elevated">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <BrandWordmark />
          <ol className="ml-auto hidden items-center gap-1 sm:flex" aria-label="Setup steps">
            {listed.map((s) => {
              const st = stepState(s, facts, progress)
              const current = s.id === stepId
              return (
                <li key={s.id}>
                  <button onClick={() => go(s.id)} aria-current={current ? 'step' : undefined}
                    className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs transition-colors ${current ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text'}`}>
                    {st === 'done' && <Check size={12} aria-hidden="true" />}
                    {s.title}
                  </button>
                </li>
              )
            })}
          </ol>
          <button onClick={putOff} className="ml-auto text-xs text-text-muted hover:text-text sm:ml-2">
            {variant === 'overlay' ? 'Close' : 'Set up later'}
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
          {stepId === 'welcome' && <WelcomeStep />}
          {stepId === 'text' && <ModelStep capability="text" />}
          {stepId === 'voice' && <VoiceStep />}
          {stepId === 'images' && <ModelStep capability="images" />}
          {stepId === 'invite' && <InviteStep />}
          {stepId === 'story' && <StoryStep onStarted={(id) => finish(id)} onOwn={() => { finish(); onNavigate('cast') }} />}
        </div>
      </div>

      <footer className="shrink-0 border-t border-border bg-bg-elevated">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-4 py-3 sm:px-6">
          {previousStep(stepId, facts) && (
            <Button variant="ghost" onClick={() => go(previousStep(stepId, facts))} className="flex items-center gap-1"><ArrowLeft size={14} /> Back</Button>
          )}
          <span className="flex-1" />
          {step.optional && state !== 'done' && <Button variant="ghost" onClick={skip}>Skip for now</Button>}
          {stepId === 'story'
            ? <Button onClick={() => finish()}>{state === 'done' ? 'Finish' : 'Finish without a story'}</Button>
            : (
              <Button variant="primary" onClick={() => go(nextStep(stepId, facts))} disabled={stepId === 'text' && state !== 'done'} className="flex items-center gap-1">
                {stepId === 'welcome' ? 'Get started' : 'Continue'} <ArrowRight size={14} />
              </Button>
            )}
        </div>
      </footer>
    </div>
  )
}

function WelcomeStep() {
  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl text-text">Welcome to Lost Tales Engine</h1>
      <p className="text-sm text-text">
        A few minutes here and you'll be playing. This sets up the model that writes the story, optionally voices and images,
        and then starts your first scene.
      </p>
      <ul className="space-y-1.5 text-sm text-text-muted">
        <li><strong className="text-text">Text model:</strong> required. A hosted service with your key, or a model server on your own computer.</li>
        <li><strong className="text-text">Voice:</strong> optional. Free voices need no account.</li>
        <li><strong className="text-text">Images:</strong> optional, for Picture this and character art.</li>
        <li><strong className="text-text">First story:</strong> pick a character and start.</li>
      </ul>
      <p className="text-xs text-text-muted">Anything you skip stays on the Get set up checklist in Settings, and ticks itself once it's done.</p>
    </div>
  )
}

const STEP_COPY: Record<'text' | 'images', { title: string; body: string; pick: string }> = {
  text: {
    title: 'Text model',
    body: 'This model writes every reply: characters, the Game Master, summaries. Add the service you use, give it its key, then pick a model. A model server on your own computer works too: add it under "On your machine" and test it.',
    pick: 'Text model',
  },
  images: {
    title: 'Images',
    body: 'Used by Picture this and for drawing character art. Optional: everything else works without it.',
    pick: 'Images model',
  },
}

/** Add a service that offers `capability`, set it up, and pick its model. */
function ModelStep({ capability }: { capability: 'text' | 'images' }) {
  const copy = STEP_COPY[capability]
  const services = useSettingsStore((s) => s.services).filter((service) => offers(service, capability))
  const value = useSettingsStore((s) => (capability === 'text' ? s.textModel : s.imageModel))
  const setModelChoice = useSettingsStore((s) => s.setModelChoice)
  const [open, setOpen] = useState<string | null>(services.length === 1 ? services[0].id : null)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl text-text">{copy.title}</h1>
        <p className="mt-1 text-sm text-text-muted">{copy.body}</p>
      </div>
      <ServiceList capability={capability} open={open} setOpen={setOpen} />
      {services.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-text-muted">{copy.pick}</span>
          <ModelPicker capability={capability} value={value} onChange={(choice) => setModelChoice(capability, choice)} label={copy.pick} />
        </div>
      )}
      {capability === 'text' && <TextTest />}
    </div>
  )
}

/** The services offering `capability`, and the menu to add one. */
function ServiceList({ capability, open, setOpen }: { capability: Capability; open: string | null; setOpen: (id: string | null) => void }) {
  const services = useSettingsStore((s) => s.services).filter((service) => offers(service, capability))
  const addChoice = useAddService()
  const groups = useMemo(() => ADD_GROUPS
    .map((group) => ({ ...group, choices: group.choices.filter((c) => SERVICE_KINDS[c.kind].offers.includes(capability)) }))
    .filter((group) => group.choices.length), [capability])
  return (
    <div className="space-y-2">
      {services.length > 0 && (
        <div className="divide-y divide-border rounded-xl border border-border">
          {services.map((service) => (
            <ServiceRow key={service.id} service={service} open={open === service.id} onToggle={() => setOpen(open === service.id ? null : service.id)} />
          ))}
        </div>
      )}
      <select aria-label="Add a service" className={selectClass} value="" onChange={(e) => {
        const id = addChoice(e.target.value)
        if (id) setOpen(id)
      }}>
        <option value="">{services.length ? 'Add another service…' : 'Add a service…'}</option>
        {groups.map((group) => (
          <optgroup key={group.label} label={group.label}>
            {group.choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

/** A real reply from the chosen Text model, so a wrong key or model shows here and not in the first scene. */
function TextTest() {
  const services = useSettingsStore((s) => s.services)
  const textModel = useSettingsStore((s) => s.textModel)
  const setProgress = useSettingsStore((s) => s.setSetupProgress)
  const { saved: secrets } = useSecretStatus()
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'ok' | 'error'; text?: string }>({ status: 'idle' })
  const resolved = chosen({ services }, textModel, 'text')
  if (!resolved) return null
  const test = async () => {
    setState({ status: 'loading' })
    try {
      const client = createTextClient(resolved.service, resolved.model, secrets)
      const reply = await client.generate({
        prompt: 'Say hello to a new player in one short, friendly sentence.',
        messages: [{ role: 'user', content: 'Say hello to a new player in one short, friendly sentence.' }],
        max_length: 60,
        max_context_length: 2048,
        quiet: true,
      })
      setState({ status: 'ok', text: reply.trim() || '(an empty reply)' })
      const progress = useSettingsStore.getState().setupProgress
      if (textModel) setProgress({ ...progress, verified: { ...progress.verified, text: verifiedKey(textModel) } })
    } catch (e) {
      setState({ status: 'error', text: errorMessage(e) })
    }
  }
  return (
    <div className="rounded-xl bg-bg-sunken p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void test()} disabled={state.status === 'loading'} className="flex items-center gap-1.5">
          {state.status === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
          {state.status === 'loading' ? 'Asking…' : 'Test it'}
        </Button>
        <span className="text-xs text-text-muted">Asks the model for a one-line hello. Continue unlocks once it answers.</span>
      </div>
      {state.status === 'ok' && <p className="mt-2 text-sm text-text"><Check size={14} className="mr-1 inline text-success" aria-hidden="true" />{state.text}</p>}
      {state.status === 'error' && <p className="mt-2 text-sm text-danger">Not working yet: {state.text}</p>}
    </div>
  )
}

/** Free voices in one click, or any other voice service. */
function VoiceStep() {
  const services = useSettingsStore((s) => s.services)
  const addService = useSettingsStore((s) => s.addService)
  const setModelChoice = useSettingsStore((s) => s.setModelChoice)
  const voiceModel = useSettingsStore((s) => s.voiceModel)
  const voiceServices = services.filter((service) => offers(service, 'voice'))
  const [open, setOpen] = useState<string | null>(null)
  const voice = chosen({ services }, voiceModel, 'voice')
  const useFree = () => {
    const existing = services.find((service) => service.kind === 'edge')
    const id = existing?.id ?? newServiceId('Edge TTS (free)', services.map((s) => s.id))
    if (!existing) addService({ id, name: 'Edge TTS (free)', kind: 'edge' })
    setModelChoice('voice', { serviceId: id, model: '' })
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl text-text">Voice</h1>
        <p className="mt-1 text-sm text-text-muted">Characters can read their lines aloud in Visual Novel mode. Optional.</p>
      </div>
      <div className="rounded-xl border border-border p-4">
        <p className="text-sm font-medium text-text">Free voices</p>
        <p className="mt-0.5 text-xs text-text-muted">Microsoft's neural voices, the ones Edge's Read Aloud uses. No account or key. You can give each character their own voice later.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {voice?.service.kind === 'edge'
            ? <span className="flex items-center gap-1 text-sm text-success"><Check size={14} aria-hidden="true" /> Using free voices</span>
            : <Button variant="primary" onClick={useFree}>Use free voices</Button>}
          {voice && <VoiceTest />}
        </div>
      </div>
      <details className="rounded-xl border border-border p-4" open={!!voice && voice.service.kind !== 'edge'}>
        <summary className="cursor-pointer text-sm text-text">Use another voice service</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs text-text-muted">ElevenLabs, Fish Audio, MiniMax, Gemini, OpenAI, a local Kokoro or AllTalk server, and others.</p>
          <ServiceList capability="voice" open={open} setOpen={setOpen} />
          {voiceServices.length > 0 && (
            <ModelPicker capability="voice" value={voiceModel} onChange={(choice) => setModelChoice('voice', choice)} label="Voice model" />
          )}
        </div>
      </details>
    </div>
  )
}

function VoiceTest() {
  const s = useSettingsStore()
  const { saved: secrets } = useSecretStatus()
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const test = async () => {
    setState('loading')
    setError('')
    try {
      const secret = s.ttsSecret ?? 'ttsApiKey'
      const blob = await synthesizeSpeech({
        provider: s.ttsProvider,
        keySaved: s.ttsProvider === 'openmayhem' ? !!secrets.openMayhemApiKey : !!secrets[secret],
        secret, model: s.ttsModel, baseUrl: s.ttsBaseUrl, region: s.ttsRegion, voice: s.ttsVoice,
      }, 'Hello! This is how I sound.', s.baseUrl)
      audioRef.current?.pause()
      const audio = new Audio(URL.createObjectURL(blob))
      audioRef.current = audio
      audio.onended = () => URL.revokeObjectURL(audio.src)
      await audio.play()
      setState('idle')
      const progress = s.setupProgress
      if (s.voiceModel) s.setSetupProgress({ ...progress, verified: { ...progress.verified, voice: verifiedKey(s.voiceModel) } })
    } catch (e) {
      setError(errorMessage(e))
      setState('error')
    }
  }
  return (
    <>
      <Button onClick={() => void test()} disabled={state === 'loading'} className="flex items-center gap-1.5">
        {state === 'loading' ? <Loader2 size={14} className="animate-spin" /> : <Volume2 size={14} />} Play a test line
      </Button>
      {state === 'error' && <span className="text-xs text-danger">{error}</span>}
    </>
  )
}

/** Owner only: accounts for the people they play with. */
function InviteStep() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl text-text">Invite players</h1>
        <p className="mt-1 text-sm text-text-muted">
          Optional. Give the people you play with their own accounts. Each sets up their own models, and their stories are their own.
          Worlds and characters stay private until their maker shares them. You can add more any time in Settings → Admin.
        </p>
      </div>
      <InvitePlayers />
    </div>
  )
}

/** The starter world first, then anyone to start with; or leave to make your own. */
function StoryStep({ onStarted, onOwn }: { onStarted: (chatId: string) => void; onOwn: () => void }) {
  const characters = useApiQuery('characters', () => charactersApi.list(), [])
  const worlds = useApiQuery('worlds', () => worldsApi.list(), [])
  const [startWith, setStartWith] = useState<string | null>(null)
  const [choosingPlayer, setChoosingPlayer] = useState(false)
  const starterWorld = worlds?.find((w) => w.id === STARTER_STORY.worldId)
  // Offered only while its world and lead are still here (an owner can delete them).
  const starterReady = !!starterWorld && !!characters?.some((c) => c.id === STARTER_STORY.leadCharacterId)
  // The bundled characters first (they're the oldest), and never a card only the player plays.
  const picks = (characters ?? []).filter((c) => !c.playerOnly).sort((a, b) => a.createdAt - b.createdAt)
  const worldName = (id?: string) => (id ? worlds?.find((w) => w.id === id)?.name : undefined)

  if (choosingPlayer && starterWorld && characters) {
    return <StarterPlayerStep world={starterWorld} characters={characters} onBack={() => setChoosingPlayer(false)} onStarted={onStarted} />
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl text-text">Your first story</h1>
        <p className="mt-1 text-sm text-text-muted">
          {starterReady ? 'Play the starter world, made to show what the engine does, or start with anyone.' : 'Pick who to start with. The next screen lets you choose the world and who you play.'}
        </p>
      </div>
      {starterReady && starterWorld && <StarterCard world={starterWorld} onPlay={() => setChoosingPlayer(true)} />}
      {characters === undefined
        ? <div className="h-24 animate-pulse rounded-xl bg-bg-sunken" />
        : picks.length
          ? (
            <div>
              {starterReady && <h2 className="mb-2 text-sm font-medium text-text">Or start with a character</h2>}
              <div className="grid gap-2 sm:grid-cols-2">
                {picks.map((c) => (
                  <button key={c.id} onClick={() => setStartWith(c.id)} className="flex items-center gap-3 rounded-xl border border-border p-3 text-left transition-colors hover:bg-bg-sunken">
                    {c.avatarDataUrl
                      ? <img src={c.avatarDataUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
                      : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-lg text-text-muted">{c.card.name.slice(0, 1).toUpperCase()}</div>}
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text">{c.card.name}</div>
                      {worldName(c.worldId) && <div className="text-[11px] text-text-muted">{worldName(c.worldId)}</div>}
                      <p className="line-clamp-2 text-xs text-text-muted">{c.card.description || c.card.personality || 'Ready to play.'}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
          : <p className="text-sm text-text-muted">There are no characters yet. Make one, or import a card, from Cast.</p>}
      <div className="rounded-xl bg-bg-sunken p-3 text-sm text-text">
        Rather build your own world and cast?{' '}
        <button onClick={onOwn} className="text-accent hover:underline">Finish here and open Cast</button>
        <span className="text-text-muted">. The checklist in Settings keeps track of what's left.</span>
      </div>
      {startWith && (
        <NewChatDialog initialCharacterId={startWith} onClose={() => setStartWith(null)} onCreated={(id) => { setStartWith(null); onStarted(id) }} />
      )}
    </div>
  )
}

/** The recommended path: the starter world, one click from here. */
function StarterCard({ world, onPlay }: { world: WorldCard; onPlay: () => void }) {
  const art = world.backgroundsNight?.[STARTER_STORY.openingBackgroundId] ?? world.backgrounds?.[STARTER_STORY.openingBackgroundId]
  return (
    <div className="overflow-hidden rounded-2xl border border-accent/40 bg-bg-elevated">
      {art && <img src={art} alt="" className="h-36 w-full object-cover sm:h-44" />}
      <div className="space-y-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-display text-lg text-text">{world.name}</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent"><Sparkles size={11} aria-hidden="true" /> Recommended</span>
          </div>
          <p className="mt-1 text-sm text-text-muted">
            A lantern-lit rail stop at the edge of a fog marsh. The last train brings a passenger nobody can name.
            The Game Master runs the scene in Visual Novel mode, and every voice works with no key.
          </p>
        </div>
        <Button variant="primary" onClick={onPlay} className="flex items-center gap-1.5"><Play size={14} /> Play the starter world</Button>
      </div>
    </div>
  )
}

/** Who you play in the starter story: its own traveller, or someone of your own. Then it starts. */
function StarterPlayerStep({ world, characters, onBack, onStarted }: {
  world: WorldCard
  characters: Character[]
  onBack: () => void
  onStarted: (chatId: string) => void
}) {
  const starterCard = characters.find((c) => c.id === STARTER_STORY.playerCharacterId)
  const [who, setWho] = useState<'starter' | 'own'>(starterCard ? 'starter' : 'own')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const setActivePlayerCharacterId = useSettingsStore((s) => s.setActivePlayerCharacterId)
  const ready = who === 'starter' ? !!starterCard : !!name.trim()

  const start = async () => {
    if (!ready || busy) return
    setBusy(true)
    setError(null)
    try {
      let cast = characters
      let player: StarterPlayer
      if (who === 'starter' && starterCard) {
        player = { id: starterCard.id, name: starterCard.card.name, isStarterCard: true }
      } else {
        // A "you only" card, like Start a story's Create: flesh it out later in Cast.
        const card = await charactersApi.create({ card: { ...blankCharacterData(name.trim()), description: description.trim() }, playerOnly: true })
        cast = [...characters, card]
        player = { id: card.id, name: card.card.name, isStarterCard: false }
      }
      const chat = await startStarterStory({ world, characters: cast, player })
      setActivePlayerCharacterId(player.id)
      onStarted(chat.id)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  const option = (selected: boolean) =>
    `w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-accent bg-accent/10' : 'border-border hover:bg-bg-sunken'}`
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl text-text">Who you play</h1>
        <p className="mt-1 text-sm text-text-muted">You arrive at {world.name} on the last train. Only you decide what your character says and does.</p>
      </div>
      <div className="space-y-2" role="radiogroup" aria-label="Who you play">
        {starterCard && (
          <button role="radio" aria-checked={who === 'starter'} onClick={() => setWho('starter')} className={`${option(who === 'starter')} flex items-center gap-3`}>
            {starterCard.avatarDataUrl
              ? <img src={starterCard.avatarDataUrl} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
              : <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-bg-sunken text-lg text-text-muted">{starterCard.card.name.slice(0, 1)}</div>}
            <div className="min-w-0">
              <div className="text-sm font-medium text-text">{starterCard.card.name}</div>
              <p className="line-clamp-3 text-xs text-text-muted">{starterCard.card.description}</p>
            </div>
          </button>
        )}
        <div className={option(who === 'own')}>
          <button role="radio" aria-checked={who === 'own'} onClick={() => setWho('own')} className="w-full text-left">
            <div className="text-sm font-medium text-text">Someone of your own</div>
            <p className="text-xs text-text-muted">A name and a few words. You can add a portrait and more in Cast later.</p>
          </button>
          {who === 'own' && (
            <div className="mt-3">
              <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={60} />
              <TextAreaField label="Short description (optional)" rows={3} value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="What others see when they meet you." />
            </div>
          )}
        </div>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center gap-2">
        <Button variant="ghost" onClick={onBack} disabled={busy} className="flex items-center gap-1"><ArrowLeft size={14} /> Back</Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={() => void start()} disabled={!ready || busy} className="flex items-center gap-1.5">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Start the story
        </Button>
      </div>
    </div>
  )
}
