import { Box, Trash2 } from 'lucide-react'
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

/**
 * Optional 3D model for Visual Novel mode. Upload a `.vrm` for this character or pick one dropped
 * into the shared `data/avatars/vrm-library/` folder. The 2D sprites above stay the fallback, and
 * turning the model off keeps the file without using it.
 */
export function VrmModelField({ value, onChange }: { value: Character['vrm']; onChange: (next: Character['vrm']) => void }) {
  const library = useApiQuery('vrm-library', () => vrmLibraryApi.list(), []) ?? []
  const fromLibrary = library.find((f) => value?.url.split('?')[0] === f.url)
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
                onChange({ url: await fileToDataUrl(file), enabled: true, label: file.name })
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
              if (pick) onChange({ url: pick.url, enabled: true, label: pick.name })
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
      </div>
    </Section>
  )
}
