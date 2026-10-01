import { useEffect, useState } from 'react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, worldsApi } from '@/lib/api/client'
import { blankCharacterData } from '@/lib/characters/cardSpec'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useModelFor } from '@/lib/hooks/useModelFor'
import { availableGreetings, createChat } from '@/lib/chat/createChat'
import { WORLD_TEMPLATES, getWorldTemplate, normalizeWorldTemplateId, type WorldTemplateId } from '@/lib/world/worldTemplates'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Modal } from '@/components/ui/Modal'
import { PlayAsSelect } from '@/components/personas/PlayAsSelect'
import { errorMessage, toastError } from '@/lib/store/useToastStore'

export function NewChatDialog({
  onCreated,
  onClose,
  initialCharacterId = '',
}: {
  onCreated: (chatId: string) => void
  onClose: () => void
  /** Pre-select this character (from the Welcome screen's "Chat with …" shortcut). */
  initialCharacterId?: string
}) {
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const client = useModelFor('story')
  const [characterId, setCharacterId] = useState<string>(initialCharacterId)
  const [worldId, setWorldId] = useState<string>('')
  const [step, setStep] = useState(0)
  const activePlayerCharacterId = useSettingsStore((s) => s.activePlayerCharacterId)
  const setActivePlayerCharacterId = useSettingsStore((s) => s.setActivePlayerCharacterId)
  // null until picked by hand: until then the player follows the last card you played (below).
  const [pickedPlayerId, setPickedPlayerId] = useState<string | null>(null)
  const [newPlayerName, setNewPlayerName] = useState('')
  const [creatingPlayer, setCreatingPlayer] = useState(false)
  const [greetingIndex, setGreetingIndex] = useState(0)
  const [starterId, setStarterId] = useState<string>('')
  const [participantIds, setParticipantIds] = useState<string[]>([])
  // Defaults to the bound world's own template (falling back to 'dating_sim'); picking a chip
  // by hand latches `modeTouched` so a later character switch doesn't clobber a deliberate choice.
  const [mode, setMode] = useState<WorldTemplateId>('dating_sim')
  const [modeTouched, setModeTouched] = useState(false)
  const [busy, setBusy] = useState(false)

  // `initialCharacterId` arrives before `characters`/`worlds` have loaded (same reason WorldsView's
  // deep-link effect exists) — pick up the bound world's template as soon as they resolve.
  useEffect(() => {
    if (modeTouched || !initialCharacterId) return
    const initialCharacter = characters.find((c) => c.id === initialCharacterId)
    if (!initialCharacter) return
    const initialWorld = worlds.find((w) => w.id === initialCharacter.worldId)
    setWorldId(initialWorld?.id ?? '')
    setMode(normalizeWorldTemplateId(initialWorld?.template))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters.length, worlds.length, initialCharacterId])

  const toggleParticipant = (id: string) => {
    setParticipantIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  const character = characters.find((c) => c.id === characterId)
  const world = worlds.find((w) => w.id === worldId)
  // The last card you played carries over as the default, unless it's this story's lead or you
  // just added it to the AI cast.
  const defaultPlayerId =
    activePlayerCharacterId && activePlayerCharacterId !== characterId && !participantIds.includes(activePlayerCharacterId) && characters.some((c) => c.id === activePlayerCharacterId)
      ? activePlayerCharacterId
      : ''
  const playerId = pickedPlayerId === null ? defaultPlayerId : pickedPlayerId === characterId ? '' : pickedPlayerId
  // The AI never voices "you only" cards or a card you've picked to play.
  const availableCharacters = characters.filter((c) => (c.worldId ?? '') === worldId && !c.playerOnly && c.id !== (pickedPlayerId ?? ''))
  const starters = character?.relationshipStarters ?? []
  const starter = starters.find((s) => s.id === starterId)
  const greetingOptions = character ? availableGreetings(character) : []

  const create = async () => {
    if (!character || busy) return
    setBusy(true)
    try {
      await doCreate()
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const doCreate = async () => {
    if (!character) return
    const player = playerId ? characters.find((c) => c.id === playerId) : undefined
    const chat = await createChat({
      character,
      world,
      player,
      participantIds: participantIds.filter((id) => id !== player?.id),
      startingAffection: starter?.startingAffection ?? 0,
      summary: starter?.blurb || undefined,
      greetingIndex: greetingOptions.length > 0 ? greetingIndex : -1,
      mode,
      client,
    })
    // Remember the pick for the next story; an explicit unnamed "You" clears it.
    if (player) setActivePlayerCharacterId(player.id)
    else if (pickedPlayerId === '') setActivePlayerCharacterId(null)
    onCreated(chat.id)
  }

  const pickPlayer = (id: string) => {
    setPickedPlayerId(id)
    // The card you play leaves the AI cast.
    if (id) setParticipantIds((prev) => prev.filter((p) => p !== id))
  }

  /** A quick "you only" card with just a name; flesh it out later in Cast. */
  const createPlayerCharacter = async () => {
    const name = newPlayerName.trim()
    if (!name || creatingPlayer) return
    setCreatingPlayer(true)
    try {
      const created = await charactersApi.create({ card: blankCharacterData(name), playerOnly: true })
      pickPlayer(created.id)
      setNewPlayerName('')
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setCreatingPlayer(false)
    }
  }

  const steps = ['World', 'Cast', 'Who you play', 'Opening scene'] as const

  return (
    <Modal onClose={onClose} title="Start a story" size="sm" hideHeaderClose scrollable>
      <div className="mb-5 flex items-center gap-1" aria-label={`Step ${step + 1} of 4: ${steps[step]}`}>
        {steps.map((label, i) => (
          <div key={label} className={`min-w-0 flex-1 border-b-2 pb-2 text-center text-[10px] sm:text-xs ${i === step ? 'border-accent text-accent' : 'border-border text-text-muted'}`}>
            {label}
          </div>
        ))}
      </div>
      <div className="min-h-52 flex-1 overflow-y-auto">
        {step === 0 && <>
          <p className="mb-3 text-sm text-text-muted">Where will this story take place?</p>
          <div className="space-y-2">
            <button onClick={() => { setWorldId(''); setCharacterId(''); setParticipantIds([]); if (!modeTouched) setMode('freeform') }}
              className={`w-full rounded-xl border p-3 text-left text-sm ${worldId === '' ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text hover:bg-bg-sunken'}`}>
              Freeform · no world
            </button>
            {worlds.map((w) => <button key={w.id} onClick={() => { setWorldId(w.id); setCharacterId(''); setParticipantIds([]); if (!modeTouched) setMode(normalizeWorldTemplateId(w.template)) }}
              className={`w-full rounded-xl border p-3 text-left text-sm ${worldId === w.id ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text hover:bg-bg-sunken'}`}>
              {w.name}
            </button>)}
          </div>
        </>}
        {step === 1 && <>
          <p className="mb-3 text-sm text-text-muted">Choose the main character, then add anyone else who can speak in this scene.</p>
          <label className="mb-1 block text-xs text-text-muted">Main character</label>
          <select value={characterId} onChange={(e) => { setCharacterId(e.target.value); setGreetingIndex(0); setStarterId(''); setParticipantIds((prev) => prev.filter((id) => id !== e.target.value)) }}
            className="mb-4 w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-sm text-text outline-none ring-1 ring-transparent focus:ring-accent/40">
            <option value="">Select a character…</option>
            {availableCharacters.map((c) => <option key={c.id} value={c.id}>{c.card.name}</option>)}
          </select>
          {availableCharacters.length === 0 && <p className="text-xs text-text-muted">This world has no characters yet. Add one in Cast first.</p>}
          {availableCharacters.length > 1 && <div>
            <label className="mb-2 block text-xs text-text-muted">Other characters (optional)</label>
            <div className="flex flex-wrap gap-1.5">{availableCharacters.filter((c) => c.id !== characterId).map((c) =>
              <button key={c.id} onClick={() => toggleParticipant(c.id)} className={`rounded-lg px-2.5 py-1 text-xs ${participantIds.includes(c.id) ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted hover:text-text'}`}>{c.card.name}</button>
            )}</div>
          </div>}
        </>}
        {step === 2 && <>
          <p className="mb-3 text-sm text-text-muted">Who are you in this story?</p>
          <PlayAsSelect className="mb-3" value={playerId} onChange={pickPlayer} characters={characters} excludeIds={characterId ? [characterId] : []} allowNone />
          <div>
            <label htmlFor="new-player-character" className="mb-1 block text-xs text-text-muted">Or create a player character</label>
            <div className="flex gap-2">
              <input id="new-player-character" value={newPlayerName} onChange={(e) => setNewPlayerName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void createPlayerCharacter() } }}
                placeholder="Your character's name"
                className="min-w-0 flex-1 rounded-xl bg-bg-sunken px-3 py-2.5 text-sm text-text outline-none ring-1 ring-transparent focus:ring-accent/40" />
              <Button variant="ghost" onClick={createPlayerCharacter} disabled={!newPlayerName.trim() || creatingPlayer}>{creatingPlayer ? 'Creating…' : 'Create'}</Button>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">Made as a "you only" card. Add a portrait and description in Cast any time.</p>
          </div>
        </>}
        {step === 3 && <>
          <p className="mb-3 text-sm text-text-muted">Choose how your story opens.</p>
          <label className="mb-1 block text-xs text-text-muted">Story style</label>
          <div className="mb-1 flex flex-wrap gap-2">{WORLD_TEMPLATES.map((t) =>
            <Chip key={t.id} on={mode === t.id} onClick={() => { setMode(t.id); setModeTouched(true) }}>{t.label}</Chip>
          )}</div>
          <p className="mb-4 text-xs text-text-muted">{getWorldTemplate(mode).blurb}</p>
          {starters.length > 0 && <div className="mb-4">
            <label className="mb-1 block text-xs text-text-muted">How you know each other</label>
            <select value={starterId} onChange={(e) => setStarterId(e.target.value)} className="w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-sm text-text outline-none">
              <option value="">Blank slate</option>
              {starters.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            {starter?.blurb && <p className="mt-1 text-xs text-text-muted">{starter.blurb}</p>}
          </div>}
          {greetingOptions.length > 0 && <div>
            <label className="mb-2 block text-xs text-text-muted">Opening line</label>
            <div className="flex flex-wrap gap-1.5">{greetingOptions.map((g, i) =>
              <button key={i} type="button" title={g} onClick={() => setGreetingIndex(i)} className={`rounded-lg px-2.5 py-1 text-xs ${greetingIndex === i ? 'bg-accent/10 text-accent' : 'bg-bg-sunken text-text-muted'}`}>Opening {i + 1}</button>
            )}</div>
            <p className="mt-2 line-clamp-3 text-xs text-text-muted">{greetingOptions[greetingIndex]}</p>
          </div>}
        </>}
      </div>
      <div className="mt-4 flex shrink-0 justify-between gap-2">
        <Button variant="ghost" onClick={() => step === 0 ? onClose() : setStep(step - 1)}>{step === 0 ? 'Cancel' : 'Back'}</Button>
        {step < 3
          ? <Button variant="primary" onClick={() => setStep(step + 1)} disabled={step === 1 && !characterId}>Continue</Button>
          : <Button variant="primary" onClick={create} disabled={!characterId || busy}>{busy ? 'Starting…' : 'Begin story'}</Button>}
      </div>
    </Modal>
  )
}
