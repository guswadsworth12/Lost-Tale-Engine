import { useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { charactersApi, momentsApi, worldsApi } from '@/lib/api/client'
import type { Character } from '@/lib/characters/cardSpec'
import { draftMomentPrompt, momentText, type MomentContext, type MomentKind, type MomentLine } from '@/lib/story/moments'
import { cardBrief } from '@/lib/characters/cardBrief'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import type { Chat, StoredMessage, WorldCard } from '@/lib/types'
import { backgroundCatalog, matchBackgroundKeyword } from '@/lib/vn/backgrounds'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { ImageGenerateDialog, useImageCapabilities, type LookReference } from '@/components/ui/GenerateImageButton'
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
 * "Picture this": a picture of something that happened in the story, made from a scene and the key
 * moments picked from it (the line being read starts picked). A moment goes to the story's gallery;
 * a background is also offered to the world for this location, and a portrait to the character
 * (replacing either asks first, since worlds and cards are shared). The prompt opens drafted from
 * the picked moments, free; the story model can write it from them and from people's cards. Which
 * pictures go along as references (people's, the location's) is the writer's pick.
 */
export function PictureThisDialog({
  chat,
  world,
  cast,
  message,
  history = [],
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
  /** The scene's messages, to pick key moments from. */
  history?: StoredMessage[]
  location?: string
  timeOfDay?: string
  /** Writes the prompt with the story model, from the draft, the key moments and people's cards. */
  improve: (prompt: string, kind: MomentKind, context: MomentContext) => Promise<string>
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
  const playerName = cast.find((c) => c.id === chat.playerCharacterId)?.card.name
  // Key moments: the scene's lines, newest first; the one being read starts picked.
  const pickable = useMemo(() => [...history, ...(message && !history.some((m) => m.id === message.id) ? [message] : [])]
    .filter((m) => !m.failed && momentText(m.text)), [history, message])
  const [picked, setPicked] = useState<string[]>(() => (message ? [message.id] : []))
  const speakerOf = (m: StoredMessage) => (m.role === 'user' ? playerName : m.name) || undefined
  const linesFor = (ids: readonly string[]): MomentLine[] => pickable.filter((m) => ids.includes(m.id)).map((m) => ({ speaker: speakerOf(m), text: m.text }))
  const draftFor = (k: MomentKind, subject = subjectId, place = slot, who = included, moments = picked) => draftMomentPrompt({
    kind: k,
    moments: linesFor(moments),
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
      const pictured = k === 'portrait' ? cast.filter((c) => c.id === subjectId) : k === 'moment' ? cast.filter((c) => included.includes(c.id)) : []
      const cards = pictured.map((c) => ({ name: c.card.name, card: cardBrief(c, { userName: playerName ?? 'the player', maxChars: 600 }) })).filter((c) => c.card)
      setPrompt((await improve(text, k, { ...(k !== 'background' ? { moments: linesFor(picked) } : {}), cards })).trim() || text)
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
  const pick = (id: string) => {
    const next = picked.includes(id) ? picked.filter((i) => i !== id) : [...picked, id]
    setPicked(next)
    setPrompt(draftFor(kind, subjectId, slot, included, next))
  }

  // Pictures that can go along as references: the people in it, and the location's own picture.
  const placeImage = slot ? world?.backgrounds?.[slot] : undefined
  const candidates: (LookReference & { key: string })[] = [
    ...(kind === 'portrait'
      ? (subject?.avatarDataUrl ? [{ key: subject.id, url: subject.avatarDataUrl, name: subject.card.name }] : [])
      : kind === 'moment' ? inPicture.filter((p) => p.image).map((p) => ({ key: p.id, url: p.image!, name: p.name })) : []),
    ...(kind !== 'portrait' && placeImage ? [{ key: 'place', url: placeImage, name: `${placeLabel(slot) ?? 'The location'} (location)` }] : []),
  ]
  // As many as the selected model takes. Unset: everyone's picture up to that, not the location's. Once touched, the writer's pick.
  const { references: takesReferences, maxReferences } = useImageCapabilities()
  const [chosenRefs, setChosenRefs] = useState<string[] | null>(null)
  const chosen = (chosenRefs ?? candidates.filter((c) => c.key !== 'place').map((c) => c.key)).slice(0, maxReferences)
  const references: LookReference[] = candidates.filter((c) => chosen.includes(c.key)).map(({ url, name }) => ({ url, name }))
  const toggleRef = (key: string) => setChosenRefs(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key])

  const save = async (dataUrl: string) => {
    setSaving(true)
    try {
      const characterIds = kind === 'portrait' ? (subject ? [subject.id] : []) : kind === 'moment' ? inPicture.map((p) => p.id) : []
      // "Go to moment" opens on the latest line it pictures.
      const messageId = [...pickable].reverse().find((m) => picked.includes(m.id))?.id ?? message?.id
      await momentsApi.create(chat.id, { kind, caption, prompt, ...(messageId ? { messageId } : {}), characterIds, image: dataUrl })
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
    <Modal onClose={onClose} title="Picture this" size="lg" scrollable>
      <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-1">
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="What to picture">
          {(Object.keys(KIND_LABEL) as MomentKind[]).map((k) => (
            <Button key={k} role="radio" aria-checked={kind === k} variant={kind === k ? 'primary' : 'secondary'} onClick={() => changeKind(k)}
              disabled={(k === 'background' && !world) || (k === 'portrait' && !cast.length)}>
              {KIND_LABEL[k]}
            </Button>
          ))}
        </div>
        {kind !== 'background' && pickable.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-sm text-text">Key moments</legend>
            <div className="max-h-48 overflow-y-auto rounded-xl border border-border">
              {[...pickable].reverse().map((m) => (
                <label key={m.id} className="flex cursor-pointer items-start gap-2 border-b border-border px-3 py-2 text-xs last:border-b-0 hover:bg-bg-sunken">
                  <input type="checkbox" className="mt-0.5" checked={picked.includes(m.id)} onChange={() => pick(m.id)} />
                  <span className="min-w-0"><span className="font-medium text-text">{speakerOf(m) ?? 'Narration'}</span>{' '}
                    <span className="text-text-muted">{momentText(m.text).slice(0, 160)}{momentText(m.text).length > 160 ? '…' : ''}</span></span>
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-text-muted">{picked.length ? `${picked.length} picked. ` : ''}Pick the moments to picture; the story model writes one image from them.</p>
          </fieldset>
        )}
        {(kind === 'background' || (kind === 'moment' && Object.values(world?.backgrounds ?? {}).some(Boolean))) && places.length > 0 && (
          <SelectField label="Location" value={slot} onChange={(e) => { setSlot(e.target.value); setPrompt(draftFor(kind, subjectId, e.target.value)); if (kind === 'background') setCaption(placeLabel(e.target.value) ?? caption) }} hint={kind === 'background' ? `Offered to ${world?.name ?? 'the world'}'s backgrounds too. Replacing one asks first.` : 'Its picture can go along as a reference.'}>
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
            <p className="mt-1 text-xs text-text-muted">Their looks go into the prompt, from their cards when the story model writes it.</p>
          </fieldset>
        )}
        {candidates.length > 0 && (
          <fieldset>
            <legend className="mb-1 text-sm text-text">Reference pictures</legend>
            <div className="flex flex-wrap gap-2">
              {candidates.map((c) => {
                const on = chosen.includes(c.key)
                return (
                  <label key={c.key} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-2 py-1.5 text-xs ${on ? 'border-accent/50 bg-accent/5' : 'border-border'} ${!on && chosen.length >= maxReferences ? 'opacity-50' : ''}`}>
                    <input type="checkbox" checked={on} disabled={!on && chosen.length >= maxReferences} onChange={() => toggleRef(c.key)} />
                    <img src={c.url} alt="" className="h-8 w-8 rounded-lg object-cover" />
                    {c.name}
                  </label>
                )
              })}
            </div>
            <p className="mt-1 text-xs text-text-muted">{takesReferences
              ? `Sent so people and places look like themselves. This model takes up to ${maxReferences}.`
              : 'The selected image model can\'t take reference images. Pick one that can in Settings → Images.'}</p>
          </fieldset>
        )}
        <TextField label="Caption" value={caption} maxLength={200} onChange={(e) => setCaption(e.target.value)} />
        <TextAreaField label="Prompt" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          hint="Drafted from the picked moments. Edit it, or have the story model write it." />
      </div>
      <div className="mt-3 shrink-0 border-t border-border pt-3">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" disabled={improving || !prompt.trim()} onClick={() => void runImprove()} className="inline-flex items-center gap-1.5">
            {improving ? <Spinner /> : <Sparkles size={14} />} Write it with the story model
          </Button>
          <Button variant="primary" disabled={improving || !prompt.trim()} onClick={() => setGenerating(true)}>Generate</Button>
        </div>
      </div>
    </Modal>
  )
}
