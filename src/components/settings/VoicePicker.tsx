import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/lib/store/useSettingsStore'
import { useSecretStatus } from '@/lib/accounts/secrets'
import { listVoices, type VoiceList } from '@/lib/voice/ttsProviders'
import type { VoiceTarget } from '@/lib/api/services'

const selectClass = 'w-full rounded-xl bg-bg-sunken px-3 py-2.5 text-base text-text outline-none ring-1 ring-transparent focus:ring-accent/40 sm:py-2 sm:text-sm'

// One list per provider, address and key, kept for the session: every picker of the same service shares it.
const lists = new Map<string, Promise<VoiceList>>()

/**
 * A voice, chosen from what `target` can speak with. The chosen voice is always one of the options;
 * a provider whose voices can't all be listed (clones, seeds, a voice library) also offers typing an id.
 * `blankLabel` is the empty choice: the provider's default, or the narrator's voice for a character.
 */
export function VoicePicker({ target, value, onChange, label = 'Voice', blankLabel }: {
  target: VoiceTarget
  value: string
  onChange: (voice: string) => void
  label?: string
  blankLabel: string
}) {
  const { saved: secrets } = useSecretStatus()
  const koboldBaseUrl = useSettingsStore((s) => s.baseUrl)
  const keySaved = !!target.secret && !!secrets[target.secret]
  const key = [target.provider, target.baseUrl ?? '', target.region ?? '', target.secret ?? '', keySaved].join('|')
  const [list, setList] = useState<VoiceList | null>(null)
  const [typing, setTyping] = useState(false)

  useEffect(() => {
    let live = true
    setList(null)
    if (!lists.has(key)) lists.set(key, listVoices(target, keySaved, koboldBaseUrl))
    void lists.get(key)!.then((loaded) => {
      // An empty list may be a service that was down: asked again next time.
      if (!loaded.voices.length) lists.delete(key)
      if (live) setList(loaded)
    })
    return () => { live = false }
    // `key` covers everything in `target` that changes the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, koboldBaseUrl])

  const voices = list?.voices ?? []
  const listed = !value || voices.some((v) => v.id === value)
  const options = listed ? voices : [{ id: value, label: value }, ...voices]
  const canType = !list || list.typable

  return (
    <div className="space-y-1.5">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
        <select aria-label={label} className={selectClass} value={typing ? '__type' : value} onChange={(e) => {
          if (e.target.value === '__type') { setTyping(true); return }
          setTyping(false)
          onChange(e.target.value)
        }}>
          <option value="">{list ? blankLabel : 'Loading voices…'}</option>
          {options.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          {canType && <option value="__type">Type a voice id…</option>}
        </select>
      </label>
      {list && !voices.length && !value && <p className="text-xs text-text-muted">It didn't list any voices. Type one's id, or check its key and address in Models and services.</p>}
      {typing && (
        <input aria-label={`${label} id`} className={selectClass} placeholder="The voice's id" autoFocus
          value={value} onChange={(e) => onChange(e.target.value)} onBlur={() => { if (!value) setTyping(false) }} />
      )}
    </div>
  )
}
