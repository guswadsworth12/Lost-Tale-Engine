import { lazy, Suspense, useState } from 'react'
import { Box, Play, Trash2 } from 'lucide-react'
import type { Character } from '@/lib/characters/cardSpec'
import { Section } from '@/components/ui/Section'
import { FileButton } from '@/components/ui/FileButton'
import { Button } from '@/components/ui/Button'
import { SelectField } from '@/components/ui/Field'
import { Toggle } from '@/components/ui/Toggle'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { vrmLibraryApi } from '@/lib/api/client'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { VRM_MOTION_SLOTS, type VrmMotionSlot } from '@/lib/vn/vrmMotion'

const VrmFigure = lazy(() => import('@/components/chat/VrmFigure'))

/**
 * Optional 3D model for Visual Novel mode. Upload a `.vrm` for this character or pick one dropped
 * into the shared `data/avatars/vrm-library/` folder. The 2D sprites above stay the fallback, and
 * turning the model off keeps the file without using it.
 */
export function VrmModelField({ value, onChange }: { value: Character['vrm']; onChange: (next: Character['vrm']) => void }) {
  const library = useApiQuery('vrm-library', () => vrmLibraryApi.list(), []) ?? []
  const motionLibrary = useApiQuery('vrma-library', () => vrmLibraryApi.motions(), []) ?? []
  const [previewSlot, setPreviewSlot] = useState<VrmMotionSlot | null>(null)
  const [previewGesture, setPreviewGesture] = useState<{ kind: 'wave' | 'smile'; nonce: number }>({ kind: 'wave', nonce: 0 })
  const [previewError, setPreviewError] = useState(false)
  const fromLibrary = library.find((f) => value?.url.split('?')[0] === f.url)
  const setMotion = (slot: VrmMotionSlot, url?: string) => {
    if (!value) return
    const motions = { ...value.motions }
    if (url) motions[slot] = url
    else delete motions[slot]
    onChange({ ...value, motions })
    setPreviewError(false)
  }
  return (
    <Section
      title="3D model (VRM)"
      icon={Box}
      description="Optional. When enabled, Visual Novel mode renders this character from a VRM model with live expressions and a speaking mouth. The 2D sprites stay as the fallback if the model can't load."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <FileButton
            accept=".vrm,model/gltf-binary"
            onPick={async (files) => {
              const file = files[0]
              try {
                onChange({ ...value, url: await fileToDataUrl(file), enabled: true, label: file.name })
              } catch (e) {
                toastError(errorMessage(e))
              }
            }}
          >
            Upload .vrm
          </FileButton>
          <SelectField
            label="Or choose from the VRM library"
            value={fromLibrary?.url ?? ''}
            onChange={(e) => {
              const pick = library.find((f) => f.url === e.target.value)
              if (pick) onChange({ ...value, url: pick.url, enabled: true, label: pick.name })
            }}
          >
            <option value="">{library.length ? 'Select a model…' : 'No models in data/avatars/vrm-library/'}</option>
            {library.map((f) => (
              <option key={f.url} value={f.url}>{f.name} ({Math.round(f.bytes / 1024)} KB)</option>
            ))}
          </SelectField>
        </div>
        {value ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-bg-sunken px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-sm text-text">
              {value.label ?? 'Uploaded model'}
              {value.url.startsWith('data:') && <span className="ml-2 text-xs text-text-muted">(uploads on save)</span>}
            </span>
            <Toggle checked={value.enabled} onChange={(enabled) => onChange({ ...value, enabled })} label="Use in VN mode" />
            <Button variant="ghost" onClick={() => onChange(undefined)} aria-label="Remove 3D model">
              <Trash2 size={14} />
            </Button>
          </div>
        ) : (
          <p className="text-xs text-text-muted">No model. This character appears as their 2D sprite.</p>
        )}
        {value && (
          <div className="space-y-3 border-t border-border pt-3">
            <div>
              <p className="text-sm font-medium text-text">Body motions (.vrma)</p>
              <p className="text-xs text-text-muted">Idle and speaking have built-in motion. Add clips for those or for an emotion; facial expressions and lip sync still work.</p>
            </div>
            {VRM_MOTION_SLOTS.map((slot) => {
              const clip = value.motions?.[slot]
              const fromMotionLibrary = motionLibrary.find((f) => clip?.split('?')[0] === f.url)
              return (
                <div key={slot} className="flex flex-wrap items-center gap-2 rounded-xl bg-bg-sunken px-3 py-2">
                  <span className="w-20 shrink-0 text-sm capitalize text-text">{slot}</span>
                  <FileButton accept=".vrma,model/gltf-binary" onPick={async (files) => {
                    try { setMotion(slot, await fileToDataUrl(files[0])) } catch (e) { toastError(errorMessage(e)) }
                  }}>Upload</FileButton>
                  <div className="min-w-[150px] flex-1">
                    <SelectField label={`Choose ${slot} motion from library`} value={fromMotionLibrary?.url ?? ''} onChange={(e) => setMotion(slot, e.target.value || undefined)}>
                      <option value="">{motionLibrary.length ? 'Library…' : 'No shared motions'}</option>
                      {motionLibrary.map((f) => <option key={f.url} value={f.url}>{f.name}</option>)}
                    </SelectField>
                  </div>
                  {clip && <span className="max-w-32 truncate text-xs text-text-muted" title={clip}>{fromMotionLibrary?.name ?? (clip.startsWith('data:') ? 'Upload pending save' : 'Custom clip')}</span>}
                  <Button variant="ghost" onClick={() => { setPreviewSlot(slot); setPreviewError(false) }} aria-label={`Preview ${slot} motion`}><Play size={14} /></Button>
                  {clip && <Button variant="ghost" onClick={() => setMotion(slot)} aria-label={`Remove ${slot} motion`}><Trash2 size={14} /></Button>}
                </div>
              )
            })}
            {previewSlot && (
              <div className="rounded-xl bg-bg-sunken p-3">
                <div className="mb-2 flex items-center justify-between text-sm"><span>Preview: {previewSlot}</span><Button variant="ghost" onClick={() => setPreviewSlot(null)}>Close</Button></div>
                <div className="mb-2 flex gap-2">
                  <Button variant="ghost" onClick={() => setPreviewGesture((prev) => ({ kind: 'wave', nonce: prev.nonce + 1 }))}>Wave</Button>
                  <Button variant="ghost" onClick={() => setPreviewGesture((prev) => ({ kind: 'smile', nonce: prev.nonce + 1 }))}>Smile</Button>
                </div>
                {previewError ? <p className="text-xs text-text-muted">Model or clip could not load. The 2D sprite remains the stage fallback.</p> : (
                  <div className="mx-auto h-64 w-48"><Suspense fallback={<p className="text-xs text-text-muted">Loading preview…</p>}>
                    <VrmFigure key={`${value.url}:${previewSlot}:${value.motions?.[previewSlot] ?? ''}`} url={value.url} motions={value.motions} label="Character preview" expression={previewSlot} speaking={previewSlot === 'speaking'} gesture={previewGesture.kind} gestureNonce={previewGesture.nonce} reducedMotion={false} onError={() => setPreviewError(true)} />
                  </Suspense></div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  )
}
