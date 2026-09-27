import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, Square, Upload } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { voiceSamplesApi } from '@/lib/api/client'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { synthesizeSpeech } from '@/lib/voice/ttsProviders'
import { FileButton } from '@/components/ui/FileButton'
import { Button } from '@/components/ui/Button'
import { errorMessage, toastError } from '@/lib/store/useToastStore'

/**
 * Picks a LuxTTS voice sample (a short WAV of the voice to clone), uploads a new one, and plays a
 * preview line through the real server. The value is the sample's file name; blank means the
 * fallback (`blankLabel`).
 */
export function VoiceSampleField({
  value,
  onChange,
  label = 'Voice sample',
  blankLabel = 'Server default',
  previewText = 'The lanterns are lit. Tell me where the story goes next.',
  uploadLabel,
}: {
  value: string
  onChange: (file: string) => void
  label?: string
  blankLabel?: string
  previewText?: string
  /** Default name for an uploaded sample, e.g. the character's name. */
  uploadLabel?: string
}) {
  const samples = useApiQuery('voice-samples', () => voiceSamplesApi.list(), []) ?? []
  const status = useApiQuery('luxtts-status', () => voiceSamplesApi.luxttsStatus(), [])
  const [busy, setBusy] = useState<'upload' | 'preview' | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)
  const stop = () => {
    controllerRef.current?.abort()
    controllerRef.current = null
    if (audioRef.current) {
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current.pause()
      audioRef.current.remove()
    }
    audioRef.current = null
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = null
    setBusy(null)
  }
  useEffect(() => stop, [])

  const preview = async () => {
    if (busy === 'preview') return stop()
    setBusy('preview')
    const controller = new AbortController()
    controllerRef.current = controller
    try {
      const blob = await synthesizeSpeech({ provider: 'luxtts', voice: value }, previewText, '', controller.signal)
      controller.signal.throwIfAborted()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.hidden = true
      document.body.append(audio)
      urlRef.current = url
      audioRef.current = audio
      await audio.play()
      if (controller.signal.aborted) return
      audio.onended = stop
      audio.onerror = () => {
        stop()
        toastError('The browser could not play the generated audio.')
      }
    } catch (e) {
      if (controller.signal.aborted) return
      stop()
      toastError(errorMessage(e))
    }
  }

  return (
    <div className="mb-3">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent focus:ring-accent/40"
        >
          <option value="">{blankLabel}</option>
          {samples.map((s) => <option key={s.file} value={s.file}>{s.label}</option>)}
          {value && !samples.some((s) => s.file === value) && <option value={value}>Missing sample ({value.slice(0, 10)}…)</option>}
        </select>
        <Button onClick={preview} disabled={busy === 'upload' || !status?.reachable} aria-label={busy === 'preview' ? 'Stop preview' : 'Preview voice'}>
          {busy === 'preview' ? <Square size={14} /> : <Play size={14} />}
        </Button>
        <FileButton
          accept=".wav,audio/wav,audio/x-wav"
          title="Upload a short, clean WAV of the voice (5–30 seconds works best)"
          onPick={async (files) => {
            setBusy('upload')
            try {
              const file = files[0]
              const added = await voiceSamplesApi.add(uploadLabel || file.name.replace(/\.wav$/i, ''), await fileToDataUrl(file))
              onChange(added.file)
            } catch (e) {
              toastError(errorMessage(e))
            } finally {
              setBusy(null)
            }
          }}
        >
          {busy === 'upload' ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Upload WAV
        </FileButton>
      </div>
      <p className={`mt-1 text-[11px] ${status?.reachable ? 'text-text-muted' : 'text-danger'}`}>
        {status ? (status.reachable ? `LuxTTS connected · ${samples.length} voice sample${samples.length === 1 ? '' : 's'}` : status.detail) : 'Checking LuxTTS…'}
      </p>
    </div>
  )
}
