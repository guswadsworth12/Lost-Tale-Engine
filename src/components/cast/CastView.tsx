import { CharactersView } from '@/components/characters/CharactersView'

/** Cast is one list of cards. Player characters are cards too, found under the list's "Player characters" filter. */
export function CastView({
  initialCharacterId,
  initialCharacterTab,
  onConsumedInitial,
}: {
  initialCharacterId?: string | null
  initialCharacterTab?: string | null
  onConsumedInitial?: () => void
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <CharactersView initialCharacterId={initialCharacterId} initialTab={initialCharacterTab} onConsumedInitial={onConsumedInitial} />
    </div>
  )
}
