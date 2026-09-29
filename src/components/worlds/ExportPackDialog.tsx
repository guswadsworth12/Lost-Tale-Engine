import { useEffect, useState } from 'react'
import { Download, Plus, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { packsApi, type PackExportPreview } from '@/lib/api/client'
import { DEFAULT_PACK_SELECTION, type PackCredit, type PackSelection } from '@/lib/packs/contract'
import { EXPORT_ROWS, formatBytes, lineFor, rowChecked, toggleRow } from '@/lib/packs/ui'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import type { WorldCard } from '@/lib/types'

const LICENCES = ['CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0', 'CC0-1.0', 'All rights reserved']

type Credit = PackCredit & { path?: string }

/** The checklist: each choice with its count and size, then the cast one by one, then what stays behind. */
export function ExportChecklist({ selection, preview, onChange }: {
  selection: PackSelection
  preview: PackExportPreview | undefined
  onChange: (selection: PackSelection) => void
}) {
  const leftOut = new Set(selection.excludeCharacterIds ?? [])
  const cast = (preview?.characters ?? []).filter((c) => selection.playerCards || !c.playerOnly)
  return <div className="space-y-4">
    <div className="space-y-1.5">
      {EXPORT_ROWS.map((row) => {
        const line = preview ? lineFor(preview.included, row.key) : undefined
        const checked = rowChecked(selection, row.key)
        const detail = [line?.count !== undefined && checked ? `${line.count}` : '', line?.bytes ? formatBytes(line.bytes) : ''].filter(Boolean).join(' · ')
        return <label key={row.key} className="flex items-start gap-2 text-sm text-text">
          <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(toggleRow(selection, row.key, e.target.checked))} />
          <span className="flex-1">
            {row.label}{row.optional && <span className="ml-1.5 rounded bg-bg-sunken px-1 text-[10px] uppercase tracking-wide text-text-muted">Off by default</span>}
            {row.hint && <span className="block text-xs text-text-muted">{row.hint}</span>}
          </span>
          {detail && <span className="shrink-0 text-xs text-text-muted">{detail}</span>}
        </label>
      })}
    </div>
    {selection.cast && cast.length > 0 && <div>
      <h3 className="mb-1.5 text-xs font-medium text-text-muted">Cast in the pack</h3>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {cast.map((c) => <label key={c.id} className="flex items-center gap-1.5 text-sm text-text">
          <input type="checkbox" checked={!leftOut.has(c.id)} onChange={(e) => onChange({
            ...selection,
            excludeCharacterIds: e.target.checked ? [...leftOut].filter((id) => id !== c.id) : [...leftOut, c.id],
          })} />
          {c.name}
        </label>)}
      </div>
    </div>}
    {preview && <div className="rounded-xl bg-bg-sunken p-3 text-xs text-text-muted">
      <p className="mb-1 font-medium text-text">Left out</p>
      <ul className="list-disc space-y-0.5 pl-4">{[...preview.excluded, ...preview.droppedReferences].map((line) => <li key={line}>{line}</li>)}</ul>
      {preview.missingMedia > 0 && <p className="mt-1 text-warning">{preview.missingMedia} media file{preview.missingMedia === 1 ? ' is' : 's are'} missing on this install and will be left out.</p>}
    </div>}
  </div>
}

/** World → Export pack: choose what goes in, say who made it and under what licence, then download. */
export function ExportPackDialog({ world, onClose }: { world: WorldCard; onClose: () => void }) {
  const [selection, setSelection] = useState<PackSelection>(DEFAULT_PACK_SELECTION)
  const [preview, setPreview] = useState<PackExportPreview>()
  const [title, setTitle] = useState(world.name)
  const [author, setAuthor] = useState('')
  const [description, setDescription] = useState('')
  const [licence, setLicence] = useState('')
  const [credits, setCredits] = useState<Credit[]>([])
  const [busy, setBusy] = useState(false)

  const request = { worldId: world.id, selection, metadata: { title: title.trim() || world.name, author: author.trim() || undefined, description: description.trim() || undefined, licence: licence.trim() || undefined, credits } }
  const selectionKey = JSON.stringify(selection)
  useEffect(() => {
    let live = true
    packsApi.exportPreview({ worldId: world.id, selection, metadata: { title: world.name } })
      .then((p) => { if (live) setPreview(p) })
      .catch((error) => toastError(errorMessage(error)))
    return () => { live = false }
  }, [world.id, selectionKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const setCredit = (i: number, patch: Partial<Credit>) => setCredits((all) => all.map((c, j) => (j === i ? { ...c, ...patch } : c)))
  const exportNow = async () => {
    setBusy(true)
    try {
      const { url } = await packsApi.startExport(request)
      // A plain download: the browser streams the zip to disk rather than into this page.
      const link = document.createElement('a')
      link.href = url
      link.click()
      toastSuccess('Your pack is downloading.')
      onClose()
    } catch (error) {
      toastError(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return <Modal title="Export world pack" size="2xl" scrollable onClose={onClose}
    description="A pack carries this world's saved setup to another install. Save any changes first. Stories, chats, memories, and accounts never go in.">
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
      <ExportChecklist selection={selection} preview={preview} onChange={setSelection} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label="Title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        <TextField label="Author (optional)" value={author} maxLength={200} onChange={(e) => setAuthor(e.target.value)} />
        <TextField label="Licence (optional)" value={licence} list="pack-licences" placeholder="CC-BY-4.0" maxLength={100} onChange={(e) => setLicence(e.target.value)} />
        <datalist id="pack-licences">{LICENCES.map((l) => <option key={l} value={l} />)}</datalist>
      </div>
      <TextAreaField label="Description (optional)" rows={2} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} />
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-text">Credits</h3>
        <p className="text-xs text-text-muted">Credit art or music by someone else, with its source and licence.</p>
        {credits.map((credit, i) => <div key={i} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
          <SelectField label="File" value={credit.path ?? ''} onChange={(e) => setCredit(i, { path: e.target.value || undefined })}>
            <option value="">The whole pack</option>
            {(preview?.media ?? []).map((m) => <option key={m.path} value={m.path}>{m.label}</option>)}
          </SelectField>
          <TextField label="Title" value={credit.title ?? ''} maxLength={200} onChange={(e) => setCredit(i, { title: e.target.value })} />
          <TextField label="Author" value={credit.author ?? ''} maxLength={200} onChange={(e) => setCredit(i, { author: e.target.value })} />
          <TextField label="Source" value={credit.source ?? ''} maxLength={500} onChange={(e) => setCredit(i, { source: e.target.value })} />
          <TextField label="Licence" value={credit.licence ?? ''} list="pack-licences" maxLength={100} onChange={(e) => setCredit(i, { licence: e.target.value })} />
          <div className="flex items-end"><Button variant="ghost" onClick={() => setCredits((all) => all.filter((_, j) => j !== i))}><X size={14} /> Remove</Button></div>
        </div>)}
        <Button variant="secondary" onClick={() => setCredits((all) => [...all, {}])}><Plus size={14} className="mr-1 inline" />Add credit</Button>
      </div>
    </div>
    <div className="mt-4 flex shrink-0 items-center justify-between gap-3 border-t border-border pt-4">
      <span className="text-xs text-text-muted">{preview ? `Media up to ${formatBytes(preview.mediaBytes)}` : 'Sizing…'}</span>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={busy || !preview} onClick={exportNow}><Download size={14} className="mr-1 inline" />{busy ? 'Starting…' : 'Export pack'}</Button>
      </div>
    </div>
  </Modal>
}
