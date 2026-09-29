import { useState } from 'react'
import { FolderOpen, Upload } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { packsApi, worldsApi } from '@/lib/api/client'
import { validateScenarioSource } from '@/lib/dating/scenarios'
import type { ConflictResolution, PackApplyResult, PackPreview } from '@/lib/packs/contract'
import { defaultResolutions, formatBytes, replacesAnything, uploadEntries } from '@/lib/packs/ui'
import { errorMessage } from '@/lib/store/useToastStore'

const pickClass = 'inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-bg-sunken px-3 py-2 text-sm font-medium text-text transition-colors hover:bg-bg-sunken/70'

const CHOICES: { id: ConflictResolution; label: string }[] = [
  { id: 'copy', label: 'Import as a copy' },
  { id: 'skip', label: 'Skip, keep mine' },
  { id: 'replace', label: 'Replace mine' },
]

/** Everything an import would do, before it does it. Conflicts get a choice each; replacing needs its own confirmation. */
export function ImportPreviewView({ preview, resolutions, onResolve, confirmReplace, onConfirmReplace }: {
  preview: PackPreview
  resolutions: Record<string, ConflictResolution>
  onResolve: (key: string, resolution: ConflictResolution) => void
  confirmReplace: boolean
  onConfirmReplace: (on: boolean) => void
}) {
  const { manifest, creates } = preview
  const list = (title: string, lines: string[], tone = 'text-text-muted') => lines.length > 0 && <div>
    <h3 className="mb-1 text-xs font-medium text-text">{title}</h3>
    <ul className={`list-disc space-y-0.5 pl-4 text-xs ${tone}`}>{lines.map((line) => <li key={line}>{line}</li>)}</ul>
  </div>
  return <div className="space-y-4 text-sm text-text">
    <div>
      <h3 className="font-medium">{manifest.title}</h3>
      <p className="text-xs text-text-muted">{[manifest.author && `By ${manifest.author}`, manifest.licence && `Licence: ${manifest.licence}`, `Lost Tales ${manifest.appVersion}`].filter(Boolean).join(' · ')}</p>
      {manifest.description && <p className="mt-1 text-xs">{manifest.description}</p>}
    </div>
    <div className="rounded-xl bg-bg-sunken p-3 text-xs">
      <p><span className="font-medium">World:</span> {creates.world}</p>
      <p><span className="font-medium">Cast ({creates.characters.length}):</span> {creates.characters.join(', ') || 'none'}</p>
      <p><span className="font-medium">World-info books ({creates.lorebooks.length}):</span> {creates.lorebooks.join(', ') || 'none'}</p>
      <p><span className="font-medium">Media:</span> {preview.mediaCount} file{preview.mediaCount === 1 ? '' : 's'}, {formatBytes(preview.mediaBytes)}</p>
      <p className="mt-1 text-text-muted">Everything is imported as yours alone. You can share it afterwards.</p>
    </div>
    {manifest.credits?.length ? list('Credits', manifest.credits.map((c) => [c.title, c.author && `by ${c.author}`, c.source, c.licence && `(${c.licence})`].filter(Boolean).join(' '))) : null}
    {preview.conflicts.length > 0 && <div className="space-y-2">
      <h3 className="text-xs font-medium">Already in your library</h3>
      {preview.conflicts.map((conflict) => <div key={conflict.key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-2.5">
        <span className="text-xs"><span className="text-text-muted">{conflict.kind === 'world' ? 'World' : 'Character'}:</span> {conflict.name}</span>
        <select aria-label={`What to do with ${conflict.name}`} className="rounded-lg border border-border bg-bg-sunken px-2 py-1 text-xs" value={resolutions[conflict.key] ?? 'copy'}
          onChange={(e) => onResolve(conflict.key, e.target.value as ConflictResolution)}>
          {CHOICES.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        </select>
      </div>)}
      {replacesAnything(resolutions) && <label className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-2.5 text-xs">
        <input type="checkbox" className="mt-0.5" checked={confirmReplace} onChange={(e) => onConfirmReplace(e.target.checked)} />
        Replace overwrites what you have with the pack's version. This can't be undone.
      </label>}
    </div>}
    {list('The exporter left out', manifest.excluded)}
    {list('Left out on import', preview.droppedReferences)}
    {list('Problems found', preview.warnings, 'text-warning')}
  </div>
}

/** Worlds → Import pack: a zip or an unzipped pack folder, previewed before anything is written. */
export function ImportPackDialog({ onClose, onImported }: { onClose: () => void; onImported: (worldId: string) => void }) {
  const [step, setStep] = useState<'pick' | 'working' | 'preview' | 'done'>('pick')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<PackPreview>()
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({})
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [result, setResult] = useState<PackApplyResult & { rejectedScenarios: string[] }>()

  const close = () => {
    if (preview && step !== 'done') void packsApi.cancel(preview.previewId).catch(() => {})
    onClose()
  }
  const pick = async (files: FileList | null) => {
    const entries = uploadEntries([...(files ?? [])])
    if (!entries.length) return setError('Choose a pack’s .zip file, or its unzipped .ltpack folder.')
    setError('')
    setStep('working')
    try {
      const uploadId = await packsApi.upload(entries, (done, total) => setProgress(total > 1 ? `Uploading ${done} of ${total} files…` : 'Uploading…'))
      setProgress('Checking the pack…')
      const seen = await packsApi.preview(uploadId)
      setPreview(seen)
      setResolutions(defaultResolutions(seen.conflicts))
      setStep('preview')
    } catch (e) {
      setError(errorMessage(e))
      setStep('pick')
    }
  }
  const apply = async () => {
    if (!preview) return
    setStep('working')
    setProgress('Importing…')
    try {
      const applied = await packsApi.apply({ previewId: preview.previewId, resolutions, confirmReplace })
      // Scene shapes are checked where they're used, in the app; one that wouldn't run is removed now.
      const rejectedScenarios: string[] = []
      const world = await worldsApi.get(applied.worldId)
      if (world?.scenarios?.length) {
        const valid = world.scenarios.filter((graph) => {
          const problems = validateScenarioSource(graph)
          if (problems.length) rejectedScenarios.push(`${(graph as { title?: string }).title ?? (graph as { id?: string }).id ?? 'A scenario'}: ${problems.join('; ')}`)
          return !problems.length
        })
        if (rejectedScenarios.length) await worldsApi.update(applied.worldId, { scenarios: valid })
      }
      setResult({ ...applied, rejectedScenarios })
      setStep('done')
    } catch (e) {
      setError(errorMessage(e))
      setStep('preview')
    }
  }
  const blocked = replacesAnything(resolutions) && !confirmReplace

  return <Modal title="Import world pack" size="xl" scrollable onClose={close}
    description="Choose a pack. You'll see everything it holds before anything is added to your library.">
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
      {step === 'pick' && <div className="flex flex-wrap gap-2">
        <label className={pickClass}><Upload size={14} />Choose a .zip<input type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => { void pick(e.target.files); e.target.value = '' }} /></label>
        <label className={pickClass}><FolderOpen size={14} />Choose a folder<input type="file" className="hidden" {...{ webkitdirectory: '', directory: '' }} multiple onChange={(e) => { void pick(e.target.files); e.target.value = '' }} /></label>
      </div>}
      {step === 'working' && <p className="text-sm text-text-muted">{progress}</p>}
      {step === 'preview' && preview && <ImportPreviewView preview={preview} resolutions={resolutions} confirmReplace={confirmReplace}
        onResolve={(key, value) => setResolutions((all) => ({ ...all, [key]: value }))} onConfirmReplace={setConfirmReplace} />}
      {step === 'done' && result && <div className="space-y-2 text-sm text-text">
        <p>Imported {preview?.creates.world ?? 'the world'}{result.characterIds.length ? ` with ${result.characterIds.length} character${result.characterIds.length === 1 ? '' : 's'}` : ''}.</p>
        {result.skipped.length > 0 && <p className="text-xs text-text-muted">Kept yours: {result.skipped.join(', ')}.</p>}
        {result.replaced.length > 0 && <p className="text-xs text-text-muted">Replaced: {result.replaced.join(', ')}.</p>}
        {result.rejectedScenarios.length > 0 && <div className="text-xs text-warning"><p>These scenarios wouldn't run and were left out:</p><ul className="list-disc pl-4">{result.rejectedScenarios.map((s) => <li key={s}>{s}</li>)}</ul></div>}
      </div>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
    <div className="mt-4 flex shrink-0 justify-end gap-2 border-t border-border pt-4">
      {step === 'done' && result
        ? <><Button variant="ghost" onClick={onClose}>Close</Button><Button variant="primary" onClick={() => onImported(result.worldId)}>Open world</Button></>
        : <><Button variant="ghost" onClick={close}>Cancel</Button>{step === 'preview' && <Button variant="primary" disabled={blocked} onClick={apply}>Import</Button>}</>}
    </div>
  </Modal>
}
