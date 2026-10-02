import { useOpenMayhemModels } from '@/lib/hooks/useOpenMayhemModels'
import { OpenMayhemVoiceField } from './OpenMayhemVoiceField'
import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { chosen, modelLabel, voiceTarget } from '@/lib/api/services'
import { synthesizeSpeech } from '@/lib/voice/ttsProviders'
import { Button } from '@/components/ui/Button'
import { Section } from '@/components/ui/Section'
import { VoiceSampleField } from './VoiceSampleField'
import { VoicePicker } from './VoicePicker'
import { SettingsPage } from '@/components/ui/SettingsPage'
import { errorMessage } from '@/lib/store/useToastStore'
import { changeVoiceConfig, useSecretStatus } from '@/lib/accounts/secrets'


export function VoiceSettings() {
  const baseUrl = useSettingsStore((s) => s.baseUrl)
  const ttsProvider = useSettingsStore((s) => s.ttsProvider)
  const ttsBaseUrl = useSettingsStore((s) => s.ttsBaseUrl)
  const ttsRegion = useSettingsStore((s) => s.ttsRegion)
  const ttsVoice = useSettingsStore((s) => s.ttsVoice)
  const ttsModel = useSettingsStore((s) => s.ttsModel)
  const services = useSettingsStore((s) => s.services)
  const voiceModel = useSettingsStore((s) => s.voiceModel)
  const voice = chosen({ services }, voiceModel, 'voice')
  const { saved: secrets } = useSecretStatus()
  const ttsSecret = useSettingsStore((s) => s.ttsSecret) ?? 'ttsApiKey'
  const ttsKeySaved = !!secrets[ttsSecret]
  const openMayhemKeySaved = secrets.openMayhemApiKey
  const { models } = useOpenMayhemModels('AUDIO_SPEECH', ttsProvider === 'openmayhem')
  const setVoiceConfig = changeVoiceConfig
  const [testState, setTestState] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState('')
  const testAudioRef = useRef<HTMLAudioElement | null>(null)

  const testControllerRef = useRef<AbortController | null>(null)
  const testUrlRef = useRef<string | null>(null)
  const stopTest = () => {
    testControllerRef.current?.abort()
    testControllerRef.current = null
    if (testAudioRef.current) {
      testAudioRef.current.onended = null
      testAudioRef.current.onerror = null
      testAudioRef.current.pause()
      testAudioRef.current.remove()
      testAudioRef.current = null
    }
    if (testUrlRef.current) URL.revokeObjectURL(testUrlRef.current)
    testUrlRef.current = null
  }
  useEffect(() => {
    setTestState('idle')
    return stopTest
  }, [ttsProvider, ttsModel, ttsVoice, ttsKeySaved, ttsBaseUrl, ttsRegion, openMayhemKeySaved])

  // Round-trips a short line through whichever provider is configured right now and plays the
  // result back — a real synthesis + playback, not just a ping, so a wrong voice ID or a key with
  // no quota left surfaces here instead of the first time a line is read aloud in a scene.
  const testConnection = async () => {
    stopTest()
    const controller = new AbortController()
    testControllerRef.current = controller
    setTestState('loading')
    setTestError('')
    try {
      const blob = await synthesizeSpeech(
        { provider: ttsProvider, keySaved: ttsProvider === 'openmayhem' ? openMayhemKeySaved : ttsKeySaved, secret: ttsSecret, model: ttsModel, baseUrl: ttsBaseUrl, region: ttsRegion, voice: ttsVoice },
        'Testing, one two three.',
        baseUrl,
        controller.signal,
      )
      controller.signal.throwIfAborted()
      const url = URL.createObjectURL(blob)
      testUrlRef.current = url
      const audio = new Audio(url)
      audio.hidden = true
      document.body.append(audio)
      testAudioRef.current = audio
      await audio.play()
      if (controller.signal.aborted) return
      const finish = () => {
        if (testAudioRef.current !== audio) return
        audio.onended = null
        audio.onerror = null
        audio.remove()
        URL.revokeObjectURL(url)
        testUrlRef.current = null
        testAudioRef.current = null
        testControllerRef.current = null
      }
      audio.onended = finish
      audio.onerror = () => {
        finish()
        setTestError('The browser could not play the generated audio.')
        setTestState('error')
      }
      setTestState('ok')
    } catch (e) {
      if (controller.signal.aborted) return
      stopTest()
      setTestState('error')
      setTestError(errorMessage(e))
    }
  }

  return (
    <SettingsPage>
      <Section
        title="Voice (text-to-speech)"
        description="Read a character's lines aloud from Visual Novel mode, with the Voice model from Settings → Models and services."
      >
          <p className="mb-3 text-sm text-text">{voice ? <>Voice comes from <strong>{modelLabel(voice.service, voice.model)}</strong>.</> : 'No Voice model is picked yet. Pick one in Models and services.'}</p>

          {voice && ttsProvider === 'openmayhem' && <>
            <OpenMayhemVoiceField model={models?.find((m) => m.id === ttsModel)} value={ttsVoice} onChange={(voice) => setVoiceConfig({ ttsVoice: voice })} />
            <p className="my-3 text-xs text-text-muted">Testing and reading lines aloud generate billed speech jobs. Visual Novel mode uses this model and voice; character voice overrides must be supported by this model. Stop requests cancellation; work already done may still be billed.</p>
          </>}

          {voice && ttsProvider === 'luxtts' && (
            <>
              <p className="mb-2 text-xs text-text-muted">
                Clones voices on your own LuxTTS server. Its address and token live in this app's
                <code className="mx-1">.env</code>(<code>LUXTTS_URL</code>, <code>LUXTTS_TOKEN</code>), never in the browser. Each
                character can have their own sample on its Voice tab; this one reads narration and anyone without one.
              </p>
              <VoiceSampleField
                label="Narrator and default voice"
                value={ttsVoice}
                onChange={(file) => setVoiceConfig({ ttsVoice: file })}
                uploadLabel="Narrator"
              />
            </>
          )}

          {voice && ttsProvider !== 'openmayhem' && ttsProvider !== 'luxtts' && ttsProvider !== 'alibaba' && (
            <>
              {ttsProvider === 'koboldcpp' && <p className="mb-2 text-xs text-text-muted">Needs a TTS-capable model (e.g. OuteTTS, Kokoro) loaded in KoboldCpp.</p>}
              {ttsProvider === 'edge' && <p className="mb-2 text-xs text-text-muted">Free, with no account: spoken by Microsoft's Read Aloud service through this app's server.</p>}
              {ttsProvider === 'novelai' && <p className="mb-2 text-xs text-text-muted">A named voice, or type any seed (a word, or two joined like <code>Aini+Ogma</code>) for a voice of its own. Up to 1000 characters a line.</p>}
              <VoicePicker target={voiceTarget(voice.service)} value={ttsVoice} onChange={(id) => setVoiceConfig({ ttsVoice: id })} label="Narrator and default voice" blankLabel="Its default voice" />
            </>
          )}

          {voice && (
            <div className="mt-3 flex items-center gap-2.5">
              <Button onClick={testConnection} disabled={testState === 'loading' || ttsProvider === 'openmayhem' && (!openMayhemKeySaved || !models?.some((m) => m.id === ttsModel))} className="flex items-center gap-1.5">
                {testState === 'loading' ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : null}
                {testState === 'loading' ? 'Testing…' : 'Test connection'}
              </Button>
              {testState === 'loading' && <Button onClick={() => { stopTest(); setTestState('idle') }}>Stop test</Button>}
              {testState === 'ok' && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 size={14} strokeWidth={2} />
                  It spoke. Connection works.
                </span>
              )}
              {testState === 'error' && (
                <span className="flex items-center gap-1 text-xs text-danger" title={testError}>
                  <XCircle size={14} strokeWidth={2} className="shrink-0" />
                  {testError}
                </span>
              )}
            </div>
          )}

          {ttsProvider === 'alibaba' && (
            <p className="text-xs text-danger">
              Not wired up yet. Model Studio's request format hasn't been confirmed against a live
              account, so this was left honest rather than guessed at. The other providers work now.
            </p>
          )}
      </Section>

    </SettingsPage>
  )
}
