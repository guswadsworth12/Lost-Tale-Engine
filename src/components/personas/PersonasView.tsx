import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { charactersApi, personasApi } from '@/lib/api/client'
import type { Persona } from '@/lib/types'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { TextAreaField, TextField } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { EditorShell } from '@/components/ui/EditorShell'
import { ViewShell } from '@/components/ui/ViewShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { confirmDialog } from '@/lib/store/useConfirmStore'

export function PersonasView() {
  const personas = useApiQuery('personas', () => personasApi.list(), []) ?? []
  const [editing, setEditing] = useState<Persona | 'new' | null>(null)

  if (editing) {
    return <PersonaEditor persona={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
  }

  return (
    <ViewShell
      title="Personas"
      description={
        <>
          A persona is who you play as in a chat: your name and a short description, used as{' '}
          {'{{user}}'} context. Any character can be your persona too: link one and its name and
          portrait follow the card. Pick who you play as when starting a chat, or change it in the Scene panel.
        </>
      }
      actions={
        <Button variant="primary" onClick={() => setEditing('new')}>
          New persona
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {personas.map((p) => (
          <button
            key={p.id}
            onClick={() => setEditing(p)}
            className="themed-shadow rounded-2xl bg-bg-elevated p-4 text-left transition-transform hover:-translate-y-0.5"
          >
            {p.avatarDataUrl ? (
              <img src={p.avatarDataUrl} alt="" className="mx-auto mb-2 h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="mx-auto mb-2 flex h-20 w-20 items-center justify-center rounded-full bg-bg-sunken text-xl text-text-muted">
                {p.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="truncate text-center text-sm font-medium text-text">{p.name}</div>
            {p.characterId && (
              <div className="mt-1 text-center text-[10px] uppercase tracking-wide text-accent">
                {p.characterMissing ? 'Character deleted' : 'Character'}
              </div>
            )}
          </button>
        ))}
        {personas.length === 0 && (
          <EmptyState
            className="col-span-full"
            action={
              <Button variant="primary" onClick={() => setEditing('new')}>
                Create your first persona
              </Button>
            }
          >
            No personas yet. If you start a chat without one, the app just tells the model your name
            is "You". A persona gives it something to work with.
          </EmptyState>
        )}
      </div>
    </ViewShell>
  )
}

function PersonaEditor({ persona, onDone }: { persona: Persona | null; onDone: () => void }) {
  const characters = useApiQuery('characters', () => charactersApi.list(), []) ?? []
  const [characterId, setCharacterId] = useState(persona?.characterId ?? '')
  const linked = characters.find((c) => c.id === characterId)
  const [name, setName] = useState(persona?.name ?? '')
  // A linked persona's server-resolved description may be the card's own; only the persona's own text is editable.
  const [description, setDescription] = useState(persona?.characterId && persona.description === linked?.card.description ? '' : persona?.description ?? '')
  const [avatarDataUrl, setAvatarDataUrl] = useState(persona?.avatarDataUrl)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const link = { characterId: characterId || null }
      if (persona) await personasApi.update(persona.id, characterId ? { description, ...link } : { name, description, avatarDataUrl, ...link })
      else await personasApi.create(characterId ? { description, characterId } : { name, description, avatarDataUrl })
    } catch (e) {
      toastError(errorMessage(e))
      return
    } finally {
      setSaving(false)
    }
    onDone()
  }

  const remove = async () => {
    if (!persona) return
    const ok = await confirmDialog({
      title: `Delete persona "${persona.name}"?`,
      body: 'Chats you played as this persona keep their history but lose the persona link.',
      confirmLabel: 'Delete persona',
      tone: 'danger',
    })
    if (!ok) return
    await personasApi.remove(persona.id)
    onDone()
  }

  return (
    <EditorShell
      onBack={onDone}
      backLabel="Personas"
      eyebrow={persona ? 'Persona' : 'New persona'}
      title={linked?.card.name || name || 'Unnamed persona'}
      footer={
        <>
          {persona ? (
            <Button variant="danger" onClick={remove}>
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={save} disabled={(!characterId && !name.trim()) || saving}>
            {saving ? 'Saving…' : persona ? 'Save changes' : 'Create persona'}
          </Button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1 block text-xs text-text-muted">Play as a character</span>
        <select
          value={characterId}
          onChange={(e) => setCharacterId(e.target.value)}
          className="w-full rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent focus:ring-accent/40"
        >
          <option value="">No, this is my own persona</option>
          {[...characters].sort((a, b) => a.card.name.localeCompare(b.card.name)).map((c) => (
            <option key={c.id} value={c.id}>{c.card.name}</option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-text-muted">
          A linked persona takes the character's name and portrait. Other characters only see the public description below, never the character's private prompts or memory.
        </span>
      </label>
      {linked ? (
        <div className="flex items-center gap-4">
          {linked.avatarDataUrl ? (
            <img src={linked.avatarDataUrl} alt="" className="h-24 w-24 rounded-full object-cover" />
          ) : (
            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-bg-sunken text-2xl text-text-muted">{linked.card.name.slice(0, 1)}</div>
          )}
          <div className="text-lg font-medium text-text">{linked.card.name}</div>
        </div>
      ) : (
      <div className="flex items-start gap-4">
        <label
          className="portrait-frame group relative flex h-24 w-24 shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-border bg-bg-sunken"
          aria-label="Change persona avatar"
        >
          {avatarDataUrl ? (
            <img src={avatarDataUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-[11px] text-text-muted">
              <ImagePlus size={18} strokeWidth={1.5} />
              Avatar
            </span>
          )}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => e.target.files?.[0] && setAvatarDataUrl(await fileToDataUrl(e.target.files[0]))}
          />
        </label>
        <div className="flex-1">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      )}
      <TextAreaField
        label={linked ? 'Public description' : 'Description'}
        placeholder={linked?.card.description || undefined}
        hint={linked
          ? "What other characters can know about you. Leave blank to use the card's own description."
          : `Who you are in this chat. Appearance, background, traits. Used as {{user}} context.`}
        rows={6}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
    </EditorShell>
  )
}
