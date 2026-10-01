import { useState } from 'react'
import { GenerateImageButton } from '@/components/ui/GenerateImageButton'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { chosen, modelLabel } from '@/lib/api/services'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'

/**
 * Settings → Images: what images are made with is picked in Models and services; this page tests
 * it and holds the Picture this preferences.
 */
export function ImageGenSettings() {
  const services = useSettingsStore((s) => s.services)
  const imageModel = useSettingsStore((s) => s.imageModel)
  const image = chosen({ services }, imageModel, 'images')
  const autoImprovePicturePrompt = useSettingsStore((s) => s.autoImprovePicturePrompt)
  const pictureIncludeEveryone = useSettingsStore((s) => s.pictureIncludeEveryone)
  const toggleFlag = useSettingsStore((s) => s.toggleFlag)
  const [preview, setPreview] = useState('')

  return (
    <SettingsPage>
      <Section
        title="Image generation"
        description="Portraits, sprites, gallery pictures and backgrounds are made with the Images model from Settings → Models and services."
        surface="bare"
      >
        <p className="mb-3 text-sm text-text">{image ? <>Images come from <strong>{modelLabel(image.service, image.model)}</strong>.</> : 'No Images model is picked yet.'}</p>
        {image && <>
          <div className="relative flex items-center gap-2">
            <span className="text-sm">Test image generation</span>
            <GenerateImageButton label="Test image generation" width={768} height={768} initialPrompt="A small lighthouse on a quiet green island, watercolor illustration, no text" onGenerated={setPreview} />
          </div>
          {preview && <img src={preview} alt="Test generation" className="mt-3 max-h-72 rounded-xl" />}
        </>}
      </Section>
      <Section title="Picture this" description="Pictures of what happened in a story, made from a scene and kept in the Gallery." surface="bare">
        <label className="flex items-start gap-2 text-sm text-text">
          <input type="checkbox" className="mt-1" checked={autoImprovePicturePrompt} onChange={() => toggleFlag('autoImprovePicturePrompt')} />
          <span>Write each prompt with the story model as it opens
            <span className="block text-xs text-text-muted">One chat call per picture. Off: the prompt is drafted from the picked moments for free, and "Write it with the story model" is a button.</span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-2 text-sm text-text">
          <input type="checkbox" className="mt-1" checked={pictureIncludeEveryone} onChange={() => toggleFlag('pictureIncludeEveryone')} />
          <span>Include everyone in the scene
            <span className="block text-xs text-text-muted">A moment starts with everyone present, you included, described in the prompt and sent as references. Off: just whoever is speaking. Either way, you can change who is in each picture.</span>
          </span>
        </label>
      </Section>
    </SettingsPage>
  )
}
