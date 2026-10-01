import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { charactersApi, momentsApi, worldsApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { draftMomentPrompt, type MomentKind } from '@/lib/story/moments'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import type { Chat, StoredMessage, WorldCard } from '@/lib/types'
import { backgroundCatalog, matchBackgroundKeyword } from '@/lib/vn/backgrounds'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { ImageGenerateDialog, type LookReference } from '@/components/ui/GenerateImageButton'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'

const KIND_LABEL: Record<MomentKind, string> = { moment: 'Moment', background: 'Background for this location', portrait: 'Portrait' }
const PURPOSE = { moment: 'cg', background: 'background', portrait: 'portrait' } as const

const firstSentence = (text: string | undefined) => ((text ?? '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] ?? '').replace(/[.!?]+$/, '')

/** How a character looks right now: their card, and the outfit or form the scene has them in. */
export function appearanceOf(character: Character, chat: Pick<Chat, 'scene'>): string {
  const outfitId = chat.scene?.appearanceOverrides?.[character.id]
  const outfit = outfitId ? character.outfits?.find((o) => o.id === outfitId) : undefined
  return [firstSentence(character.card.description), outfit ? (outfit.kind === 'form' ? `in ${outfit.label} form` : `wearing ${outfit.label}`) : ''].filter(Boolean).join(', ')
}


/**
 * "Picture this": a picture of something that happened in the story, made from a scene (and the
 * line being read, when there is one). A moment goes to the story's gallery; a background is also
 * offered to the world for this location, and a portrait to the character (replacing either asks
 * first, since worlds and cards are shared). The prompt opens drafted from the scene, free; the
 * story model can improve it.
 */
export function PictureThisDialog({
  chat,
  world,
  cast,
  message,
  location,
  timeOfDay,
  improve,
  autoImprove = false,
  includeEveryone = true,
  onClose,
}: {
  chat: Chat
  world?: WorldCard
  /** Characters present in the scene, the player's own character included. */
  cast: Character[]
  message?: StoredMessage
  location?: string
  timeOfDay?: string
  /** Rewrites a prompt with the story model. */
  improve: (prompt: string, kind: MomentKind) => Promise<string>
  /** Improve the draft as soon as the dialog opens. */
  autoImprove?: boolean
  /** A moment starts with everyone present in it; off, just the speaker of the line. */
  includeEveryone?: boolean
  onClose: () => void
}) {
  const [kind, setKind] = useState<MomentKind>('moment')
  const [subjectId, setSubjectId] = useState(cast[0]?.id ?? '')
  const people = useMemo(() => cast.map((c) => ({ id: c.id, name: c.card.name, appearance: appearanceOf(c, chat), image: c.avatarDataUrl || undefined })), [cast, chat])
  const [included, setIncluded] = useState<string[]>(() => {
    if (includeEveryone) return people.map((p) => p.id)
    const speaker = message?.role === 'user' ? people.find((p) => p.id === chat.playerCharacterId) : people.find((p) => p.name === message?.name)
    return speaker ? [speaker.id] : []
  })
  const inPicture = people.filter((p) => included.includes(p.id))
  const places = useMemo(() => [...backgroundCatalog(world), ...(world?.customBackgrounds ?? [])], [world])
  const [slot, setSlot] = useState(() => matchBackgroundKeyword(location ?? '', places) ?? places[0]?.id ?? '')
  const [caption, setCaption] = useState((message?.text ?? location ?? '').replace(/\s+/g, ' ').trim().slice(0, 80))
  const placeLabel = (id: string) => places.find((p) => p.id === id)?.label
  const draftFor = (k: MomentKind, subject = subjectId, place = slot, who = included) => draftMomentPrompt({
    kind: k,
    messageText: message?.text,
    speaker: message?.role === 'user' ? undefined : message?.name,
    // A background is of the picked location, when the scene doesn't name one.
    location: k === 'background' ? location || placeLabel(place) : location,
    timeOfDay,
    characters: (k === 'portrait' ? people : people.filter((p) => who.includes(p.id))).map((p) => ({ name: p.name, appearance: p.appearance })),
    subject: cast.find((c) => c.id === subject)?.card.name,
    artStyle: world?.artStyle,
  })
  const [prompt, setPrompt] = useState(() => draftFor('moment'))
  const [improving, setImproving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const autoRan = useRef(false)

  const runImprove = async (text = prompt, k = kind) => {
    setImproving(true)
    try {
      setPrompt((await improve(text, k)).trim() || text)
    } catch (e) {
      toastError(`Couldn't improve the prompt: ${errorMessage(e)}`)
    } finally {
      setImproving(false)
    }
  }
  useEffect(() => {
    if (autoImprove && !autoRan.current) {
      autoRan.current = true
      void runImprove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changeKind = (next: MomentKind) => {
    setKind(next)
    setPrompt(draftFor(next))
    if (next === 'background') setCaption(placeLabel(slot) ?? caption)
    if (next === 'portrait') setCaption(cast.find((c) => c.id === subjectId)?.card.name ?? caption)
  }
  const subject = cast.find((c) => c.id === subjectId)
  const toggle = (id: string) => {
    const next = included.includes(id) ? included.filter((i) => i !== id) : people.filter((p) => p.id === id || included.includes(p.id)).map((p) => p.id)
    setIncluded(next)
    setPrompt(draftFor('moment', subjectId, slot, next))
  }
  const references: LookReference[] = kind === 'portrait'
    ? (subject?.avatarDataUrl ? [{ url: subject.avatarDataUrl, name: subject.card.name }] : [])
    : kind === 'moment' ? inPicture.filter((p) => p.image).map((p) => ({ url: p.image!, name: p.name })) : []

  const save = async (dataUrl: string) => {
    setSaving(true)
    try {
      const characterIds = kind === 'portrait' ? (subject ? [subject.id] : []) : kind === 'moment' ? inPicture.map((p) => p.id) : []
      await momentsApi.create(chat.id, { kind, caption, prompt, ...(message ? { messageId: message.id } : {}), characterIds, image: dataUrl })
      if (kind === 'background' && world && slot) {
        const fresh = await worldsApi.get(world.id)
        const label = placeLabel(slot) ?? slot
        const replace = !fresh?.backgrounds?.[slot] || await confirmDialog({ title: `Replace ${label}?`, body: `${world.name} already has a picture for ${label}. Every story in this world will use the new one.`, confirmLabel: 'Replace' })
        if (fresh && replace) await worldsApi.update(world.id, { backgrounds: { ...fresh.backgrounds, [slot]: dataUrl } })
      }
      if (kind === 'portrait' && subject) {
        const replace = !subject.avatarDataUrl || await confirmDialog({ title: `Use this as ${subject.card.name}'s portrait?`, body: 'It replaces their current portrait everywhere. It is kept in the story gallery either way.', confirmLabel: 'Replace portrait' })
        if (replace) await charactersApi.update(subject.id, { avatarDataUrl: dataUrl })
      }
      toastSuccess('Saved to the story gallery.')
      onClose()
    } catch (e) {
      toastError(errorMessage(e))
      setSaving(false)
    }
  }

  if (generating) {
    return (
      <ImageGenerateDialog
        title={`Picture this: ${KIND_LABEL[kind].toLowerCase()}`}
        purpose={PURPOSE[kind]}
        initialPrompt={prompt}
        references={references}
        onUse={(dataUrl) => void save(dataUrl)}
        onClose={() => { if (!saving) setGenerating(false) }}
      />
    )
  }

  return (
    <Modal onClose={onClose} title="Picture this" size="lg">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What to picture">
          {(Object.keys(KIND_LABEL) as MomentKind[]).map((k) => (
            <Button key={k} role="radio" aria-checked={kind === k} variant={kind === k ? 'primary' : 'secondary'} onClick={() => changeKind(k)}
              disabled={(k === 'background' && !world) || (k === 'portrait' && !cast.length)}>
              {KIND_LABEL[k]}
            </Button>
          ))}
        </div>
        {kind === 'background' && (
          <SelectField label="Location" value={slot} onChange={(e) => { setSlot(e.target.value); setPrompt(draftFor('background', subjectId, e.target.value)); setCaption(placeLabel(e.target.value) ?? caption) }} hint={`Offered to ${world?.name ?? 'the world'}'s backgrounds too. Replacing one asks first.`}>
            {places.map((p) => <option key={p.id} value={p.id}>{p.label}{world?.backgrounds?.[p.id] ? ' (has a picture)' : ''}</option>)}
          </SelectField>
        )}
        {kind === 'portrait' && (
          <SelectField label="Who" value={subjectId} onChange={(e) => { setSubjectId(e.target.value); setPrompt(draftFor('portrait', e.target.value)) }}
            hint="Offered as their portrait too. Replacing it asks first.">
            {cast.map((c) => <option key={c.id} value={c.id}>{c.card.name}</option>)}
          </SelectField>
        )}
        {kind === 'moment' && people.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-sm text-text">In the picture</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 text-sm text-text">
                  <input type="checkbox" checked={included.includes(p.id)} onChange={() => toggle(p.id)} />
                  {p.name}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-text-muted">Their looks go into the prompt, and their pictures can be sent so they look like themselves.</p>
          </fieldset>
        )}
        <TextField label="Caption" value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} />
        <TextAreaField label="Prompt" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          hint="Drafted from the scene. Edit it, or have the story model improve it." />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" disabled={improving || !prompt.trim()} onClick={() => void runImprove()} className="inline-flex items-center gap-1.5">
            {improving ? <Spinner /> : <Sparkles size={14} />} Improve with the story model
          </Button>
          <Button variant="primary" disabled={improving || !prompt.trim()} onClick={() => setGenerating(true)}>Generate</Button>
        </div>
      </div>
    </Modal>
  )
}
