import { useState } from 'react'
import { openMayhemImageLabel } from '@/lib/api/openMayhemKrea'
import { useOpenMayhemModels } from '@/lib/hooks/useOpenMayhemModels'
import { OpenMayhemModelSelect } from './OpenMayhemModelSelect'
import { OpenMayhemMediaKey } from './OpenMayhemMediaKey'
import { Button } from '@/components/ui/Button'
import { GenerateImageButton } from '@/components/ui/GenerateImageButton'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { IMAGE_BACKEND_LABELS, type ImageBackendId } from '@/lib/api/imageBackend'
import { NOVELAI_IMAGE_MODELS } from '@/lib/api/novelaiImage'
import { OPENAI_IMAGE_DEFAULT_MODEL, OPENAI_IMAGE_MODELS } from '@/lib/api/openaiImage'
import { GEMINI_IMAGE_DEFAULT_MODEL } from '@/lib/api/geminiImage'
import { createImageBackend } from '@/lib/api/createImageBackend'
import { TextField, SelectField } from '@/components/ui/Field'
import { Section } from '@/components/ui/Section'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { changeImageBackendConfig, useSecretStatus } from '@/lib/accounts/secrets'
import { SecretKeyField } from './SecretKeyField'

const IMAGE_BACKENDS = Object.keys(IMAGE_BACKEND_LABELS) as ImageBackendId[]

const LOCAL_BACKEND_DEFAULTS: Record<'a1111' | 'comfyui' | 'swarmui', string> = {
  a1111: 'http://127.0.0.1:7860',
  comfyui: 'http://127.0.0.1:8188',
  swarmui: 'http://127.0.0.1:7801',
}

export function ImageGenSettings() {
  const imageBackend = useSettingsStore((s) => s.imageBackend)
  const imageBackendBaseUrl = useSettingsStore((s) => s.imageBackendBaseUrl)
  const imageBackendUsername = useSettingsStore((s) => s.imageBackendUsername)
  const { saved: secrets } = useSecretStatus()
  const imageBackendModel = useSettingsStore((s) => s.imageBackendModel)
  const imageBackendQuality = useSettingsStore((s) => s.imageBackendQuality)
  const [geminiModels, setGeminiModels] = useState<string[] | null>(null)
  const setImageBackendConfig = changeImageBackendConfig

  const { models, loading, reload } = useOpenMayhemModels('IMAGES', imageBackend === 'openmayhem')
  const [preview, setPreview] = useState('')

  const isLocal = imageBackend === 'a1111' || imageBackend === 'comfyui' || imageBackend === 'swarmui'

  return (
    <SettingsPage>
      <Section
        title="Image generation"
        description="Generates portraits, sprites, gallery CGs, and backgrounds using the backend selected here."
        surface="bare"
      >
        <SelectField
          label="Backend"
          value={imageBackend}
          onChange={(e) => {
            const backend = e.target.value as ImageBackendId
            const patch: Parameters<typeof setImageBackendConfig>[0] = { imageBackend: backend }
            // A fresh local-backend pick with no URL yet gets a sane default instead of a blank
            // field — the same convenience the chat-backend provider picker already gives.
            if ((backend === 'a1111' || backend === 'comfyui' || backend === 'swarmui') && !imageBackendBaseUrl) {
              patch.imageBackendBaseUrl = LOCAL_BACKEND_DEFAULTS[backend]
            }
            setImageBackendConfig(patch)
          }}
        >
          {IMAGE_BACKENDS.map((id) => (
            <option key={id} value={id}>
              {IMAGE_BACKEND_LABELS[id]}
            </option>
          ))}
        </SelectField>

        {imageBackend === 'openmayhem' && <>
          <OpenMayhemMediaKey />
          <OpenMayhemModelSelect kind="image" models={models?.map((m) => m.id) ?? null} loading={loading} value={imageBackendModel}
            labels={Object.fromEntries((models ?? []).map((m) => [m.id, openMayhemImageLabel(m)]))}
            onChange={(model) => { setImageBackendConfig({ imageBackendModel: model }); setPreview('') }} />
          <Button onClick={reload} disabled={loading}>Refresh models</Button>
          <p className="my-3 text-xs text-text-muted">Uses the selected model's default steps and guidance. Image dimensions fit the slot and the model's limits. Each image is a billed job; stopping requests cancellation, but work already done may still be billed.</p>
          <div className="relative flex items-center gap-2">
            <span className="text-sm">Test image generation</span>
            <GenerateImageButton label="Test image generation" width={768} height={768} initialPrompt="A small lighthouse on a quiet green island, watercolor illustration, no text" onGenerated={setPreview} />
          </div>
          {preview && <img src={preview} alt="OpenMayhem test generation" className="mt-3 max-h-72 rounded-xl" />}
        </>}

        {(imageBackend === 'openai-image' || imageBackend === 'gemini-image') && <>
          <SecretKeyField
            name={imageBackend === 'openai-image' ? 'openaiApiKey' : 'geminiApiKey'}
            label={imageBackend === 'openai-image' ? 'OpenAI API key' : 'Gemini API key'}
            saved={imageBackend === 'openai-image' ? secrets.openaiApiKey : secrets.geminiApiKey}
            hint={imageBackend === 'gemini-image' ? 'From Google AI Studio. The same key will serve Gemini chat and speech later.' : undefined}
          />
          <TextField
            label="Model"
            value={imageBackendModel}
            onChange={(e) => { setImageBackendConfig({ imageBackendModel: e.target.value }); setPreview('') }}
            placeholder={imageBackend === 'openai-image' ? OPENAI_IMAGE_DEFAULT_MODEL : GEMINI_IMAGE_DEFAULT_MODEL}
            list={`${imageBackend}-models`}
          />
          <datalist id={`${imageBackend}-models`}>
            {(imageBackend === 'openai-image' ? OPENAI_IMAGE_MODELS : geminiModels ?? []).map((m) => <option key={m} value={m} />)}
          </datalist>
          {imageBackend === 'gemini-image' && (
            <Button className="mb-3" disabled={!secrets.geminiApiKey} onClick={async () => setGeminiModels(await createImageBackend({ imageBackend, imageBackendBaseUrl, imageBackendUsername, imageBackendModel, secrets }).listModels())}>
              List image models
            </Button>
          )}
          {imageBackend === 'openai-image' && (
            <SelectField label="Quality" value={imageBackendQuality} onChange={(e) => setImageBackendConfig({ imageBackendQuality: e.target.value })}
              hint="Higher quality costs more per image. dall-e-3 takes Standard or HD.">
              <option value="">Model default</option>
              {/^dall-e-3/i.test(imageBackendModel) ? <><option value="standard">Standard</option><option value="hd">HD</option></>
                : <><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></>}
            </SelectField>
          )}
          <p className="my-3 text-xs text-text-muted">
            {imageBackend === 'openai-image'
              ? 'Each image is billed to your OpenAI account. gpt-image models can make transparent sprites and use a character\'s portrait as a reference; dall-e-3 can do neither.'
              : 'Each image counts against your Gemini API quota. Gemini can use a character\'s portrait as a reference, but can\'t make transparent images: sprites get a plain background instead.'}
          </p>
          <div className="relative flex items-center gap-2">
            <span className="text-sm">Test image generation</span>
            <GenerateImageButton label="Test image generation" purpose="background" initialPrompt="A small lighthouse on a quiet green island, watercolor illustration, no text" onGenerated={setPreview} />
          </div>
          {preview && <img src={preview} alt="Test generation" className="mt-3 max-h-72 rounded-xl" />}
        </>}

        {isLocal && (
          <TextField
            label="Server URL"
            value={imageBackendBaseUrl}
            onChange={(e) => setImageBackendConfig({ imageBackendBaseUrl: e.target.value })}
            placeholder={LOCAL_BACKEND_DEFAULTS[imageBackend as 'a1111' | 'comfyui' | 'swarmui']}
          />
        )}

        {imageBackend === 'a1111' && (
          <>
            <p className="mb-2 text-xs text-text-muted">
              Requires launching with <code className="font-mono">--api</code> (add{' '}
              <code className="font-mono">--api-auth user:pass</code> too if this server is reachable
              by anyone else on your network).
            </p>
            <TextField
              label="Username (optional)"
              value={imageBackendUsername}
              onChange={(e) => setImageBackendConfig({ imageBackendUsername: e.target.value })}
            />
            <SecretKeyField name="imageBackendPassword" label="Password (optional)" saved={secrets.imageBackendPassword} />
          </>
        )}

        {imageBackend === 'comfyui' && (
          <p className="mb-2 text-xs text-text-muted">
            Uses ComfyUI's own default txt2img workflow (checkpoint → positive/negative prompt →
            sampler → save) with your prompt and settings substituted in. A heavily customized
            workflow of your own isn't supported yet.
          </p>
        )}

        {imageBackend === 'swarmui' && (
          <p className="mb-2 text-xs text-text-muted">
            No login needed for a default local install. If yours requires an account, this isn't
            wired up yet. Sessions are requested anonymously.
          </p>
        )}

        {(isLocal || imageBackend === 'novelai-image') && (
          <TextField
            label={imageBackend === 'novelai-image' ? 'Model' : 'Checkpoint / model (optional)'}
            value={imageBackendModel}
            onChange={(e) => setImageBackendConfig({ imageBackendModel: e.target.value })}
            placeholder={imageBackend === 'novelai-image' ? NOVELAI_IMAGE_MODELS[0] : 'Leave blank to use whatever is already loaded'}
            list={imageBackend === 'novelai-image' ? 'novelai-image-models' : undefined}
          />
        )}
        {imageBackend === 'novelai-image' && (
          <datalist id="novelai-image-models">
            {NOVELAI_IMAGE_MODELS.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        )}

        {imageBackend === 'novelai-image' && (
          <SecretKeyField
            name="imageBackendPassword"
            label="API key"
            saved={secrets.imageBackendPassword}
            hint="Same NovelAI account as the chat backend, if you use both. Not shared automatically since either can be configured alone."
          />
        )}

        <p className="mt-2 text-xs text-text-muted">
          {imageBackend === 'openmayhem' ? 'Images are downloaded into Lost Tales Engine, so saved assets remain available after OpenMayhem artifacts expire.'
            : imageBackend === 'openai-image' || imageBackend === 'gemini-image' ? 'Keys are saved encrypted to your account on your Lost Tales Engine server, which attaches the key and forwards requests. Generated images are saved into Lost Tales Engine.'
            : imageBackend === 'novelai-image'
            ? 'Keys are saved encrypted to your account on your Lost Tales Engine server, which attaches the key and forwards requests to NovelAI.'
            : 'Requests pass through your Lost Tales Engine server to the server URL above; it attaches the saved password, if any.'}
        </p>
      </Section>
    </SettingsPage>
  )
}
