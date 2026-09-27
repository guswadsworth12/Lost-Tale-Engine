import { useEffect, useState } from 'react'
import { CharactersView } from '@/components/characters/CharactersView'
import { PersonasView } from '@/components/personas/PersonasView'

export function CastView({
  initialCharacterId,
  onConsumedInitial,
}: {
  initialCharacterId?: string | null
  onConsumedInitial?: () => void
}) {
  const [tab, setTab] = useState<'characters' | 'players'>('characters')
  useEffect(() => {
    if (initialCharacterId) setTab('characters')
  }, [initialCharacterId])
  const activeTab = initialCharacterId ? 'characters' : tab

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex gap-2 border-b border-border bg-bg-elevated px-4 py-2 sm:px-8" role="tablist" aria-label="Cast">
        <button role="tab" aria-selected={activeTab === 'characters'} onClick={() => setTab('characters')}
          className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === 'characters' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text'}`}>
          Characters
        </button>
        <button role="tab" aria-selected={activeTab === 'players'} onClick={() => setTab('players')}
          className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === 'players' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text'}`}>
          Player characters
        </button>
      </div>
      {activeTab === 'characters'
        ? <CharactersView initialCharacterId={initialCharacterId} onConsumedInitial={onConsumedInitial} />
        : <PersonasView />}
    </div>
  )
}
