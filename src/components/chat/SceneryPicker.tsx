import { useMemo, useState } from 'react'
import { ImagePlus, Moon, Pin, Sun, Wand2 } from 'lucide-react'
import type { WorldCard } from '@/lib/types'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { FileButton } from '@/components/ui/FileButton'
import { TextField } from '@/components/ui/Field'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { backgroundCatalog, backgroundLabel, slugifyBackgroundId } from '@/lib/vn/backgrounds'
import { sceneGradient } from '@/lib/vn/placeholder'
import type { SceneryChoice, SceneryVariant } from '@/lib/vn/scenery'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { worldsApi } from '@/lib/api/client'
import { errorMessage, toastError } from '@/lib/store/useToastStore'

/**
 * In-chat scenery picker. Choosing a place pins it for this branch (model scene tags stop moving
 * the stage until "Follow the story" is chosen again); the day/night control is independent. See
 * `vn/scenery.ts` for the full rule and how the choice rides the branch through fork and rewind.
 */
export function SceneryPicker({
  world,
  current,
  shownBackgroundId,
  onChoose,
  onClose,
}: {
  world: WorldCard
  current: SceneryChoice | undefined
  /** What the stage shows right now, pinned or not — highlighted in the grid. */
  shownBackgroundId?: string
  onChoose: (choice: { backgroundId: string | null; variant: SceneryVariant }) => Promise<void>
  onClose: () => void
}) {
  const [variant, setVariant] = useState<SceneryVariant>(current?.variant ?? 'auto')
  const [uploadLabel, setUploadLabel] = useState('')
  const [dayFile, setDayFile] = useState<File | null>(null)
  const [nightFile, setNightFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)

  // Places with art first — those are what the stage can actually show — then the rest of the catalog.
  const places = useMemo(() => {
    const ids = new Set([...Object.keys(world.backgrounds ?? {}), ...(world.customBackgrounds ?? []).map((b) => b.id), ...backgroundCatalog(world).map((b) => b.id)])
    return [...ids]
      .map((id) => ({ id, label: backgroundLabel(id, world), day: world.backgrounds?.[id], night: world.backgroundsNight?.[id] }))
      .sort((a, b) => Number(!!b.day) - Number(!!a.day))
  }, [world])

  const choose = async (backgroundId: string | null) => {
    setBusy(true)
    try {
      await onChoose({ backgroundId, variant })
      onClose()
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const upload = async () => {
    if (!dayFile || !uploadLabel.trim()) return
    setBusy(true)
    try {
      const fresh = (await worldsApi.get(world.id)) ?? world
      const id = slugifyBackgroundId(uploadLabel.trim(), places.map((p) => p.id))
      await worldsApi.update(world.id, {
        customBackgrounds: [...(fresh.customBackgrounds ?? []), { id, label: uploadLabel.trim() }],
        backgrounds: { ...(fresh.backgrounds ?? {}), [id]: await fileToDataUrl(dayFile) },
        ...(nightFile ? { backgroundsNight: { ...(fresh.backgroundsNight ?? {}), [id]: await fileToDataUrl(nightFile) } } : {}),
      })
      await onChoose({ backgroundId: id, variant })
      onClose()
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const pinnedId = current?.backgroundId ?? null
  return (
    <Modal
      title="Scenery"
      description="Pick where this scene takes place. A place you pick stays pinned on this branch, even when a reply tags a different background, until you choose Follow the story."
      onClose={onClose}
      size="lg"
      scrollable
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SegmentedControl<SceneryVariant>
          size="sm"
          value={variant}
          onChange={setVariant}
          options={[
            { value: 'auto', label: 'World clock' },
            { value: 'day', label: 'Day' },
            { value: 'night', label: 'Night' },
          ]}
        />
        <Button variant={pinnedId ? 'secondary' : 'primary'} disabled={busy} onClick={() => choose(null)}>
          <Wand2 size={14} /> Follow the story
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="list" aria-label="World backgrounds">
        {places.map((p) => {
          const art = variant === 'night' ? p.night ?? p.day : p.day
          const isPinned = pinnedId === p.id
          const isShown = shownBackgroundId === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="listitem"
              disabled={busy}
              onClick={() => choose(p.id)}
              aria-pressed={isPinned}
              className={`group relative aspect-video overflow-hidden rounded-xl text-left ring-2 transition ${isPinned ? 'ring-accent' : isShown ? 'ring-white/40' : 'ring-transparent hover:ring-border'}`}
              style={art ? undefined : { background: sceneGradient(p.id, { night: variant === 'night' }) }}
            >
              {art && <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />}
              <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-4 text-xs text-white">
                {isPinned && <Pin size={11} />}
                <span className="truncate">{p.label}</span>
                <span className="ml-auto flex gap-0.5 opacity-80">
                  {p.day && <Sun size={11} aria-label="day art" />}
                  {p.night && <Moon size={11} aria-label="night art" />}
                  {!p.day && <span className="text-[10px]">no art</span>}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <div className="mt-4 rounded-xl bg-bg-sunken p-3">
        <p className="mb-2 flex items-center gap-1.5 text-sm font-medium text-text"><ImagePlus size={14} /> Add a new place to this world</p>
        <TextField label="Place name" value={uploadLabel} onChange={(e) => setUploadLabel(e.target.value)} placeholder="Guild hall balcony" />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <FileButton accept="image/png,image/jpeg,image/webp" onPick={(files) => setDayFile(files[0])}>Day image</FileButton>
          <span>{dayFile?.name ?? 'required'}</span>
          <FileButton accept="image/png,image/jpeg,image/webp" onPick={(files) => setNightFile(files[0])}>Night image</FileButton>
          <span>{nightFile?.name ?? 'optional'}</span>
          <Button variant="primary" className="ml-auto" disabled={busy || !dayFile || !uploadLabel.trim()} onClick={upload}>Upload and use</Button>
        </div>
      </div>
    </Modal>
  )
}
