import { useEffect, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { createImageBackend } from '@/lib/api/createImageBackend'
import { capabilitiesOf, IMAGE_BACKEND_LABELS, SLOT_SIZES, type ImageCapabilities, type ImagePurpose } from '@/lib/api/imageBackend'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { errorMessage } from '@/lib/store/useToastStore'
import { Button } from '@/components/ui/Button'
import { TextAreaField } from '@/components/ui/Field'
import { IconButton } from '@/components/ui/IconButton'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'

/** Said to a model that can't make transparent images, so a sprite is at least easy to cut out. */
export const PLAIN_BACKGROUND = 'isolated on a plain, flat, light background'

/** What the selected image backend and model can do, including how many reference images it takes. */
export function useImageCapabilities(): ImageCapabilities {
  const { saved: secrets } = useSecretStatus()
  const settings = useSettingsStore()
  const backend = createImageBackend({
    imageBackend: settings.imageBackend,
    imageBackendBaseUrl: settings.imageBackendBaseUrl,
    imageBackendUsername: settings.imageBackendUsername,
    imageBackendModel: settings.imageBackendModel,
    imageBackendQuality: settings.imageBackendQuality,
    imageBackendSecret: settings.imageBackendSecret,
    secrets,
  })
  return capabilitiesOf(backend, settings.imageBackendModel)
}

/** An image to match someone's look, and whose it is. */
export interface LookReference {
  url: string
  name?: string
}

/** The prompt with the references named in the order they're sent, so the model knows who is who. */
export function withReferenceNames(prompt: string, references: readonly LookReference[]): string {
  const names = references.map((r) => r.name?.trim()).filter(Boolean)
  if (names.length !== references.length || !names.length) return prompt
  return `${prompt} ${names.length === 1 ? `Reference image: ${names[0]}.` : `Reference images, in order: ${names.join(', ')}.`}`
}

/** An image the app shows (a saved path or a data URL), as a reference to send to a backend. */
export async function imageReference(url: string): Promise<{ base64: string; mimeType: string }> {
  const blob = await (await fetch(url)).blob()
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
  const [head, base64] = dataUrl.split(',')
  return { base64, mimeType: /data:([^;]+)/.exec(head)?.[1] || blob.type || 'image/png' }
}

/**
 * Generating an image for a slot: prompt, preview, then try again or use it (hosted providers bill
 * per image, so nothing is saved unseen). A sprite slot can ask for a transparent background; a
 * slot with a character can pass their image so their look carries over. What the selected model
 * can't do is said, not silently dropped.
 */
export function ImageGenerateDialog({
  purpose,
  initialPrompt,
  width,
  height,
  referenceImage,
  references: givenReferences,
  onUse,
  onClose,
  title = 'Generate an image',
}: {
  purpose?: ImagePurpose
  initialPrompt: string
  width?: number
  height?: number
  /** The character's portrait or sprite, offered as "Match their look". */
  referenceImage?: string
  /** Several people's images, for a picture with more than one person in it. */
  references?: LookReference[]
  onUse: (dataUrl: string) => void
  onClose: () => void
  title?: string
}) {
  const [prompt, setPrompt] = useState(initialPrompt)
  const [transparent, setTransparent] = useState(purpose === 'sprite')
  const references = givenReferences ?? (referenceImage ? [{ url: referenceImage }] : [])
  const [matchLook, setMatchLook] = useState(references.length > 0)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState('')
  const [error, setError] = useState('')
  const controllerRef = useRef<AbortController | null>(null)

  const { saved: secrets } = useSecretStatus()
  const settings = useSettingsStore()
  const backend = createImageBackend({
    imageBackend: settings.imageBackend,
    imageBackendBaseUrl: settings.imageBackendBaseUrl,
    imageBackendUsername: settings.imageBackendUsername,
    imageBackendModel: settings.imageBackendModel,
    imageBackendQuality: settings.imageBackendQuality,
    imageBackendSecret: settings.imageBackendSecret,
    secrets,
  })
  const caps = capabilitiesOf(backend, settings.imageBackendModel)
  useEffect(() => () => controllerRef.current?.abort(), [])

  const size = purpose ? SLOT_SIZES[purpose] : { width: width ?? 832, height: height ?? 1216 }
  const generate = async () => {
    if (!prompt.trim() || busy) return
    setBusy(true)
    setError('')
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const wantsTransparent = purpose === 'sprite' && transparent
      const sent = matchLook && caps.references ? references.slice(0, caps.maxReferences) : []
      const base = wantsTransparent && !caps.transparency ? `${prompt.trim()}, ${PLAIN_BACKGROUND}` : prompt.trim()
      const text = withReferenceNames(base, sent)
      const referenceImages = sent.length ? await Promise.all(sent.map(async (r) => ({ ...await imageReference(r.url), ...(r.name ? { name: r.name } : {}) }))) : undefined
      const result = await backend.generateImage({
        prompt: text,
        width: width ?? size.width,
        height: height ?? size.height,
        steps: 28,
        cfgScale: 7,
        model: settings.imageBackendModel || undefined,
        purpose,
        ...(wantsTransparent && caps.transparency ? { transparent: true } : {}),
        ...(referenceImages ? { referenceImages } : {}),
      }, controller.signal)
      controller.signal.throwIfAborted()
      if (!result.base64) throw new Error('The backend returned no image data.')
      setPreview(`data:${result.mimeType || 'image/png'};base64,${result.base64}`)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorMessage(e))
    } finally {
      controllerRef.current = null
      setBusy(false)
    }
  }

  return (
    <Modal onClose={() => { controllerRef.current?.abort(); onClose() }} title={title} size="lg">
      <div className="space-y-3">
        <TextAreaField label="Prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. portrait of a young woman, dark purple twintails, library background"
          hint={`Sends to ${IMAGE_BACKEND_LABELS[settings.imageBackend] ?? settings.imageBackend}. See Settings → Models and services.`} />
        {purpose === 'sprite' && (
          <label className="flex items-start gap-2 text-sm text-text">
            <input type="checkbox" className="mt-1" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
            <span>Transparent background
              {transparent && !caps.transparency && <span className="block text-xs text-text-muted">This model can't make transparent images. It will be asked for a plain background instead.</span>}
            </span>
          </label>
        )}
        {references.length > 0 && (
          <label className="flex items-start gap-2 text-sm text-text">
            <input type="checkbox" className="mt-1" checked={matchLook && caps.references} disabled={!caps.references} onChange={(e) => setMatchLook(e.target.checked)} />
            <span>Match their look
              <span className="block text-xs text-text-muted">{!caps.references ? 'This backend can\'t take a reference image.'
                : references.length === 1 ? 'Sends their current image as a reference.'
                : `Sends ${references.length > caps.maxReferences ? `the first ${caps.maxReferences} of their ${references.length}` : `their ${references.length}`} images as references, named in the prompt.`}</span>
            </span>
          </label>
        )}
        {error && <p className="rounded-lg bg-danger/10 p-2 text-xs text-danger" role="alert">{error}</p>}
        {preview && <img src={preview} alt="Generated preview" className="mx-auto max-h-80 rounded-xl bg-[repeating-conic-gradient(#8883_0%_25%,transparent_0%_50%)] bg-[length:16px_16px]" />}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => { controllerRef.current?.abort(); if (!busy) onClose() }}>{busy ? 'Stop' : 'Cancel'}</Button>
          {preview && !busy && <Button variant="primary" onClick={() => { onUse(preview); onClose() }}>Use this</Button>}
          <Button variant={preview ? 'secondary' : 'primary'} onClick={() => void generate()} disabled={busy || !prompt.trim()} className="inline-flex items-center gap-1.5">
            {busy ? <><Spinner /> Generating…</> : preview ? 'Try again' : 'Generate'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

/** The small sparkle on an image slot that opens `ImageGenerateDialog`. */
export function GenerateImageButton({
  onGenerated,
  initialPrompt = '',
  label = 'Generate with AI',
  width,
  height,
  purpose,
  referenceImage,
}: {
  onGenerated: (dataUrl: string) => void
  initialPrompt?: string
  label?: string
  /** Overrides the slot's own shape. */
  width?: number
  height?: number
  /** Which slot this is: picks the shape, and offers transparency on a sprite. */
  purpose?: ImagePurpose
  referenceImage?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <IconButton icon={Sparkles} title={label} onClick={() => setOpen(true)} size={13} boxSize={26} />
      {open && (
        <ImageGenerateDialog title={label} purpose={purpose} initialPrompt={initialPrompt} width={width} height={height}
          referenceImage={referenceImage} onUse={onGenerated} onClose={() => setOpen(false)} />
      )}
    </>
  )
}
