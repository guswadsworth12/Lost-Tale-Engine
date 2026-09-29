import { useState } from 'react'
import { Pin, PinOff, X } from 'lucide-react'
import type { WorldModules } from '@/lib/world/worldTemplates'
import type { useChatSession } from '@/lib/hooks/useChatSession'
import type { Chat, ScenePolicy, Story } from '@/lib/types'
import type { sceneSettingFrom } from '@/lib/chat/sceneSetting'
import { computeWarmth, getRelationshipStats, getRelationshipTrack } from '@/lib/dating/stage'
import { PHASES } from '@/lib/world/calendar'
import { errorMessage, toastError } from '@/lib/store/useToastStore'
import { PlayAsSelect } from '@/components/personas/PlayAsSelect'
import { StoryScenes } from '@/components/story/StoryScenes'
import { campaignStats, sheetForWorld } from '@/lib/world/campaign'
import { setEventsDoneFrom } from '@/lib/world/gm'
import { SetEventsEditor } from '@/components/story/SetEventsEditor'

export type StoryTab = 'scene' | 'scenes' | 'goals' | 'people' | 'sheet' | 'canon' | 'notes' | 'rules'
const TABS: { id: StoryTab; label: string }[] = [
  { id: 'scene', label: 'Scene' }, { id: 'scenes', label: 'Scenes' }, { id: 'goals', label: 'Goals' }, { id: 'people', label: 'People' },
  { id: 'sheet', label: 'Sheet' }, { id: 'canon', label: 'Canon' }, { id: 'notes', label: 'Notes' }, { id: 'rules', label: 'Scene Rules' },
]
const POLICIES: { id: ScenePolicy; label: string }[] = [
  { id: 'manual', label: 'Manual' }, { id: 'round_robin', label: 'Round robin' },
  { id: 'director', label: 'AI picks' }, { id: 'gm', label: 'Game Master' }, { id: 'mention', label: '@Mention' },
]
const inputClass = 'w-full rounded-lg border border-border bg-bg-sunken px-3 py-2 text-sm text-text outline-none focus:border-accent'
const actionClass = 'rounded-lg border border-border px-3 py-1.5 text-xs text-text hover:bg-bg-sunken'

export function StoryPanel({
  session, modules, setting, tab, onTabChange, pinned, onPin, onClose, onJump,
  onSwitchPlayer, allCharacters, onOpenRelationship, onOpenObjective, onOpenScenery,
  onOpenCalendar, onOpenWorldFact, onOpenScene, datingToolsVisible,
  onOpenEvent, onOpenDayPlanner, onOpenBag,
  story, scenes, currentSceneId, onOpenStoryScene, onEndScene, onReadStory,
}: {
  session: ReturnType<typeof useChatSession>
  modules: WorldModules
  setting: ReturnType<typeof sceneSettingFrom>
  tab: StoryTab
  onTabChange: (tab: StoryTab) => void
  pinned: boolean
  onPin: () => void
  onClose: () => void
  onJump: (id: string) => void
  /** Switches the played card (`useChatSession().switchPlayer`); false when refused. Omitted hides Play As. */
  onSwitchPlayer?: (id: string) => Promise<boolean>
  allCharacters: NonNullable<ReturnType<typeof useChatSession>['character']>[]
  onOpenRelationship: () => void
  onOpenObjective: () => void
  onOpenScenery: () => void
  onOpenCalendar: () => void
  onOpenWorldFact: () => void
  onOpenScene: () => void
  datingToolsVisible: boolean
  onOpenEvent: () => void
  onOpenDayPlanner: () => void
  onOpenBag: () => void
  /** The story this chat is a scene of; unset for a story of one scene. */
  story?: Story
  /** The story's scenes (`scenesOfStory`); defaults to just this chat. */
  scenes?: Chat[]
  /** Defaults to this chat. */
  currentSceneId?: string
  /** Opens another scene of the story (switches the active chat). Not `onOpenScene`, which is the
   *  existing "More scene rules" panel opener above. */
  onOpenStoryScene?: (chatId: string) => void
  /** Starts ending the current scene (the End Scene dialog). Omitted hides the button. */
  onEndScene?: () => void
  /** Opens the whole-story reader (`StoryTranscript`). Omitted hides the button. */
  onReadStory?: () => void
}) {
  const { chat, world, character, playerCharacter, participantCharacters, messages, activeObjective } = session
  const [location, setLocation] = useState(setting.location ?? '')
  const [atmosphere, setAtmosphere] = useState(setting.atmosphere ?? '')
  const [goalTitle, setGoalTitle] = useState('')
  const [taskText, setTaskText] = useState('')
  const [note, setNote] = useState(chat?.authorNote?.text ?? '')
  const [gmNotes, setGmNotes] = useState(chat?.gmNotes ?? '')
  const [playAs, setPlayAs] = useState(chat?.playerCharacterId ?? '')
  const [busy, setBusy] = useState(false)
  if (!chat) return null

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    try { await action() } catch (error) { toastError(errorMessage(error)) } finally { setBusy(false) }
  }
  const loaded = [character, ...participantCharacters].filter((member): member is NonNullable<typeof member> => !!member)
  const present = chat.scene?.presentCharacterIds ?? loaded.map((member) => member.id)
  const proposals = messages.flatMap((message) => (message.gm?.proposals ?? [])
    .filter((proposal) => proposal.status === 'pending').map((proposal) => ({ message, proposal })))
  const pinnedMessages = messages.filter((message) => message.pinned)
  const currentScene = scenes?.find((scene) => scene.id === (currentSceneId ?? chat.id)) ?? chat
  const canEndScene = !!onEndScene && !currentScene.endedAt && !chat.endedAt
  const sheetFields = world?.campaign?.mode === 'mechanical' ? campaignStats(world.campaign) : []
  const playerSheet = world ? sheetForWorld(playerCharacter, world.id) : undefined
  const sheetWorldMismatch = !playerSheet && !!(playerCharacter?.sheet || Object.keys(playerCharacter?.sheets ?? {}).length)
  const panel = <section className="flex h-full w-full min-w-0 flex-col border-l border-border bg-bg-elevated md:w-80" aria-label="Story panel">
    <div className="flex items-center justify-between border-b border-border px-4 py-3">
      <strong className="font-display text-sm text-text">Story</strong>
      <div className="flex gap-1">
        <button onClick={onPin} className="rounded-lg p-1.5 text-text-muted hover:bg-bg-sunken" title={pinned ? 'Unpin panel' : 'Pin panel'} aria-label={pinned ? 'Unpin panel' : 'Pin panel'}>{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
        <button onClick={onClose} className="rounded-lg p-1.5 text-text-muted hover:bg-bg-sunken" title="Close Story panel" aria-label="Close Story panel"><X size={17} /></button>
      </div>
    </div>
    <div role="tablist" aria-label="Story sections" className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-2">
      {TABS.filter((entry) => entry.id !== 'sheet' || world?.campaign?.mode === 'mechanical').map((entry) => <button key={entry.id} role="tab" aria-selected={tab === entry.id} onClick={() => onTabChange(entry.id)}
        className={`shrink-0 rounded-lg px-2 py-1.5 text-xs ${tab === entry.id ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-bg-sunken hover:text-text'}`}>
        {entry.label}{entry.id === 'canon' && proposals.length > 0 ? ` · ${proposals.length}` : ''}
      </button>)}
    </div>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 text-sm text-text">
      {tab === 'scene' && <>
        <div><h3 className="font-medium">Place and atmosphere</h3><p className="mt-1 text-xs text-text-muted">Where this branch is now. Changes follow the story when you rewind.</p></div>
        <label className="block space-y-1 text-xs text-text-muted">Location<input className={inputClass} value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Current location" /></label>
        <label className="block space-y-1 text-xs text-text-muted">Atmosphere<input className={inputClass} value={atmosphere} onChange={(event) => setAtmosphere(event.target.value)} placeholder="Mood or weather in this scene" /></label>
        <button className={actionClass} disabled={busy} onClick={() => run(() => session.updateScene({ location: location.trim() || null, atmosphere: atmosphere.trim() || null }))}>Save scene</button>
        {world && modules.worldSimulation && <p className="text-xs text-text-muted">Day {(world.currentDay ?? 0) + 1} · {chat.scene?.timePhase ?? PHASES[world.currentPhaseIndex ?? 0]}</p>}
        <div><h3 className="font-medium">Here now</h3><p className="mt-1 text-xs text-text-muted">{loaded.filter((member) => present.includes(member.id)).map((member) => member.card.name).join(', ') || 'No cast selected'}</p></div>
        <div className="flex flex-wrap gap-2">{world && <button className={actionClass} onClick={onOpenScenery}>Choose scenery</button>}{world && modules.worldSimulation && <button className={actionClass} onClick={onOpenCalendar}>Key dates</button>}</div>
        {datingToolsVisible && <div className="flex flex-wrap gap-2"><button className={actionClass} onClick={onOpenEvent}>Date or event</button>{world && modules.worldSimulation && <button className={actionClass} onClick={onOpenDayPlanner}>Day planner</button>}</div>}
      </>}
      {tab === 'scenes' && <>
        <div><h3 className="font-medium">Scenes</h3><p className="mt-1 text-xs text-text-muted">Each scene is its own chat. Ending one writes a recap and opens the next with the story's state.</p></div>
        {canEndScene || onReadStory ? <div className="flex flex-wrap gap-2">
          {canEndScene && <button className={actionClass} onClick={onEndScene}>End scene…</button>}
          {onReadStory && <button className={actionClass} onClick={onReadStory}>Read the whole story</button>}
        </div> : null}
        <StoryScenes story={story} scenes={scenes?.length ? scenes : [chat]} currentSceneId={currentSceneId ?? chat.id} onOpenScene={onOpenStoryScene} showSequelLink />
      </>}
      {tab === 'goals' && <>
        {activeObjective ? <>
          <div><h3 className="font-medium">{activeObjective.title}</h3>{activeObjective.description && <p className="mt-1 text-xs text-text-muted">{activeObjective.description}</p>}</div>
          <div className="space-y-2">{activeObjective.tasks.map((task) => <label key={task.id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={task.status === 'done'} onChange={() => run(() => session.toggleTask(task.id))} /><span>{task.description}</span></label>)}</div>
          <div className="flex gap-2"><input className={inputClass} value={taskText} onChange={(event) => setTaskText(event.target.value)} placeholder="Next step" /><button className={actionClass} disabled={!taskText.trim() || busy} onClick={() => run(async () => { await session.addManualTask(taskText); setTaskText('') })}>Add</button></div>
          <button className={actionClass} disabled={busy} onClick={() => run(() => session.setObjectiveStatus('completed'))}>Mark complete</button>
        </> : <><p className="text-xs text-text-muted">Give the story a current goal.</p><input className={inputClass} value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="Objective" /><button className={actionClass} disabled={!goalTitle.trim() || busy} onClick={() => run(async () => { await session.createObjective(goalTitle, '', 'user'); setGoalTitle('') })}>Set goal</button></>}
        <button className={actionClass} onClick={onOpenObjective}>More goal options</button>
      </>}
      {tab === 'people' && <>
        {loaded.map((member) => {
          const track = getRelationshipTrack(chat, member.id)
          const warmth = computeWarmth(track.affection ?? 0, getRelationshipStats(track))
          return <div key={member.id} className="rounded-xl border border-border p-3"><h3 className="font-medium">{member.card.name}</h3><p className="mt-1 text-xs text-text-muted">{modules.relationships ? `Connection · ${warmth}` : 'In this story'}</p>{modules.relationships && <div className="mt-2 flex flex-wrap gap-1.5">{Object.entries(getRelationshipStats(track)).map(([dimension, value]) => <span key={dimension} className="rounded-md bg-bg-sunken px-2 py-1 text-[11px] text-text-muted">{dimension[0].toUpperCase() + dimension.slice(1)} {value}</span>)}</div>}</div>
        })}
        {datingToolsVisible && <div className="flex flex-wrap gap-2"><button className={actionClass} onClick={onOpenRelationship}>Dating details</button><button className={actionClass} onClick={onOpenBag}>Bag and gifts</button></div>}
      </>}
      {tab === 'sheet' && <>
        <div><h3 className="font-medium">{playerCharacter?.card.name ?? 'Player character'} sheet</h3><p className="mt-1 text-xs text-text-muted">These saved values are used for this world’s checks.</p></div>
        {!playerCharacter ? <p className="text-xs text-text-muted">Choose a player character in Scene Rules, then fill in their Sheet tab in Cast.</p>
          : sheetWorldMismatch ? <p className="text-xs text-text-muted">This character has other sheets, but none for this world. Add one in Cast → Sheet.</p>
          : !playerSheet ? <p className="text-xs text-text-muted">This character has no sheet yet. Set their stats in Cast → Sheet; rolls use a manual value until then.</p>
          : sheetFields.map((stat) => <div key={stat.id} className="flex items-center justify-between gap-3 rounded-lg bg-bg-sunken px-3 py-2"><div><strong className="text-sm">{stat.name}</strong>{stat.description && <p className="text-xs text-text-muted">{stat.description}</p>}</div><span className="font-mono text-sm">{typeof playerSheet.stats[stat.id] === 'number' ? `${playerSheet.stats[stat.id] >= 0 && stat.valueMode !== 'ability' && stat.valueMode !== 'target' ? '+' : ''}${playerSheet.stats[stat.id]}` : '—'}</span></div>)}
      </>}
      {tab === 'canon' && <>
        <h3 className="font-medium">Confirmed world facts</h3>
        {world?.canonFacts?.length ? world.canonFacts.map((fact) => <p key={fact.id} className="rounded-lg bg-bg-sunken p-2 text-xs">{fact.text}</p>) : <p className="text-xs text-text-muted">No confirmed world facts yet.</p>}
        <button className={actionClass} onClick={onOpenWorldFact} disabled={!world}>Record a fact</button>
        <h3 className="font-medium">Pending GM proposals {proposals.length > 0 && <span className="rounded-full bg-accent/15 px-1.5 text-xs text-accent">{proposals.length}</span>}</h3>
        {proposals.length ? proposals.map(({ message, proposal }) => <div key={`${message.id}-${proposal.id}`} className="rounded-xl border border-border p-3"><p className="text-xs">{proposal.text}</p><p className="my-2 text-xs text-text-muted">{proposal.scope === 'world' ? 'World canon' : 'This branch'}</p><div className="flex gap-2"><button className={actionClass} disabled={busy} onClick={() => run(() => session.decideGmProposal(message.id, proposal.id, 'confirmed'))}>Confirm</button><button className={actionClass} disabled={busy} onClick={() => run(() => session.decideGmProposal(message.id, proposal.id, 'rejected'))}>Reject</button></div></div>) : <p className="text-xs text-text-muted">No pending proposals.</p>}
      </>}
      {tab === 'notes' && <>
        <label className="block space-y-1 text-xs text-text-muted">Author's note<textarea className={`${inputClass} min-h-28`} value={note} onChange={(event) => setNote(event.target.value)} /></label>
        <button className={actionClass} disabled={busy} onClick={() => run(() => session.updateAuthorNote(note.trim() ? { text: note.trim(), position: chat.authorNote?.position ?? 'after_char', depth: chat.authorNote?.depth ?? 4 } : null))}>Save note</button>
        <h3 className="font-medium">Pinned moments</h3>
        {pinnedMessages.length ? pinnedMessages.map((message) => <div key={message.id} className="flex items-start gap-2 rounded-lg bg-bg-sunken p-2"><button className="min-w-0 flex-1 text-left text-xs hover:text-accent" onClick={() => onJump(message.id)}>{message.text.slice(0, 180)}</button><button className="text-xs text-text-muted hover:text-text" onClick={() => run(() => session.togglePinMessage(message.id))}>Unpin</button></div>) : <p className="text-xs text-text-muted">Pin a message to find it here.</p>}
      </>}
      {tab === 'rules' && <>
        <label className="block space-y-1 text-xs text-text-muted">Turn policy<select className={inputClass} value={chat.scene?.turnPolicy ?? 'manual'} onChange={(event) => run(() => session.updateScene({ turnPolicy: event.target.value as ScenePolicy }))}>{POLICIES.filter((policy) => policy.id !== 'gm' || !!modules.campaignRules).map((policy) => <option key={policy.id} value={policy.id}>{policy.label}</option>)}</select></label>
        {modules.campaignRules === 'mechanical' && chat.scene?.turnPolicy !== 'gm' && <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-text"><p>Only explicit rolls reach the Game Master in this older turn mode. Use the Game Master policy to have it identify checks before characters respond.</p><button className={`${actionClass} mt-2`} disabled={busy} onClick={() => run(() => session.updateScene({ turnPolicy: 'gm' }))}>Use Game Master</button></div>}
        {chat.scene?.turnPolicy === 'gm' && modules.campaignRules === 'guided' && <p className="text-xs text-text-muted">Guided outcomes follow the ruleset's spirit; they are not full rules enforcement.</p>}
        <h3 className="font-medium">Loaded characters</h3>
        {allCharacters.filter((member) => member.id !== character?.id && !member.playerOnly && member.id !== chat.playerCharacterId).map((member) => <label key={member.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={(chat.participants ?? []).includes(member.id)} onChange={() => run(() => session.updateParticipants((chat.participants ?? []).includes(member.id) ? (chat.participants ?? []).filter((id) => id !== member.id) : [...(chat.participants ?? []), member.id]))} />{member.card.name}</label>)}
        <label className="block space-y-1 text-xs text-text-muted">GM notes<textarea className={`${inputClass} min-h-24`} value={gmNotes} onChange={(event) => setGmNotes(event.target.value)} /></label>
        <button className={actionClass} disabled={busy} onClick={() => run(() => session.updateGmNotes(gmNotes))}>Save GM notes</button>
        {modules.campaignRules && <SetEventsEditor events={chat.setEvents ?? []}
          doneIds={[...(chat.setEventsDone ?? []), ...setEventsDoneFrom(messages)]}
          onSave={(events) => run(() => session.updateSetEvents(events))} />}
        {onSwitchPlayer && <>
          <h3 className="font-medium">Play As</h3>
          <PlayAsSelect value={playAs} onChange={setPlayAs} characters={allCharacters} excludeIds={character ? [character.id] : []} allowNone={!chat.playerCharacterId} />
          <button className={actionClass} disabled={busy || !playAs || playAs === chat.playerCharacterId} onClick={() => run(async () => {
            if (!(await onSwitchPlayer(playAs))) setPlayAs(chat.playerCharacterId ?? '')
          })}>Switch player</button>
        </>}
        <button className={actionClass} onClick={onOpenScene}>More scene rules</button>
      </>}
    </div>
  </section>

  return <>
    {(!pinned || typeof window !== 'undefined') && <div className={`fixed inset-0 z-40 bg-black/40 ${pinned ? 'md:hidden' : ''}`} onClick={onClose} aria-hidden="true" />}
    <div className={pinned ? 'fixed inset-y-0 right-0 z-50 flex w-full max-w-sm md:static md:z-auto md:w-80 md:max-w-none md:shrink-0' : 'fixed inset-y-0 right-0 z-50 flex w-full max-w-sm'}>{panel}</div>
  </>
}
