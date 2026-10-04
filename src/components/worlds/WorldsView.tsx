import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Globe, ImagePlus, Moon, Music, Plus, Star, X } from 'lucide-react'
import { useApiQuery } from '@/lib/hooks/useApiQuery'
import { worldsApi } from '@/lib/api/client'
import type { CustomSceneFlag, GiftItem, GiftRarity, ItemDef, ItemEffect, RelationshipDimension, WorldCard } from '@/lib/types'
import { fileToDataUrl } from '@/lib/characters/importExport'
import { SCENERY_SETS, backgroundCatalog, backgroundLabel, scenerySetFor, slugifyBackgroundId, type CustomBackground, type ScenerySetId } from '@/lib/vn/backgrounds'
import { BGM_DEFAULT_KEY, SCENE_MOODS } from '@/lib/vn/moods'
import { combinedSceneFlags, COMMITMENT_ORDER, formatCommitmentStatus, formatRelationshipStage, RELATIONSHIP_MILESTONES } from '@/lib/dating/stage'
import { intimacyArousalWeight, type IntimacyCategory, type IntimacyUnlockable } from '@/lib/dating/intimacyCatalog'
import { BODY_REGIONS } from '@/lib/dating/arousal'
import { BUILT_IN_KINKS } from '@/lib/dating/kinks'
import { advancePhase, calendarMonths, dayForDate, formatCalendarDate, getCalendarInfo, getEnergyRemaining, getMaxEnergyForDay, getWeather, describeWeather, PHASES, yearLength, type WorldCalendar } from '@/lib/world/calendar'
import { CalendarEditor } from './CalendarEditor'
import { WORLD_TEMPLATES, getWorldTemplate, modulesForWorld, normalizeWorldTemplateId, type WorldModuleChoices, type WorldModules, type WorldTemplateId } from '@/lib/world/worldTemplates'
import { WORLD_TAB_ALIASES } from '@/lib/ui/navigation'
import { newId } from '@/lib/id'
import { NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import type { IntimacyDetailLevel } from '@/lib/store/useSettingsStore'
import { TriggerActionRows, TriggerConditionRows } from '@/components/worlds/TriggerRows'
import { describeAction, describeCondition, slugifyTriggerId, type Trigger } from '@/lib/world/triggers'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Section } from '@/components/ui/Section'
import { EditorShell, type EditorTab } from '@/components/ui/EditorShell'
import { ViewShell } from '@/components/ui/ViewShell'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListEditor } from '@/components/ui/ListEditor'
import { errorMessage, toastError, toastSuccess } from '@/lib/store/useToastStore'
import { FileButton } from '@/components/ui/FileButton'
import { confirmDialog } from '@/lib/store/useConfirmStore'
import { LorebookEditor } from '@/components/worldinfo/LorebookEditor'
import { GenerateImageButton } from '@/components/ui/GenerateImageButton'
import { WorldTemplateGallery } from './WorldTemplateGallery'
import { CAMPAIGN_PRESETS, DEFAULT_CAMPAIGN, campaignFileFrom, campaignNeedsTarget, campaignStats, parseCampaignFile, statForMove, type CampaignConfig, type CampaignRank, type CampaignStat, type PbtaMove } from '@/lib/world/campaign'
import { describeBands, describeDice, tierLabels } from '@/lib/world/customRules'
import { MAX_RANKS, RANK_NAME_MAX, RANK_NOTE_MAX, moveItem, nextRankName, rankLadderProblem } from './rankLadder'
import { ChoiceEffectsField, EffectsField, TracksEditor } from './TracksEditor'
import { ExportPackDialog } from './ExportPackDialog'
import { ImportPackDialog } from './ImportPackDialog'
import { VisibilityField } from '@/components/ui/VisibilityField'
import type { Visibility } from '@/lib/packs/contract'
import { removeTrack, tracksProblem } from './tracks'
import { PromptItemsEditor } from '@/components/characters/PromptItemsEditor'
import type { PromptItem } from '@/lib/prompt/items'

const GIFT_RARITIES: GiftRarity[] = ['common', 'uncommon', 'rare', 'epic']
const RELATIONSHIP_DELTA_DIMENSIONS: ('affection' | RelationshipDimension)[] = [
  'affection',
  'trust',
  'chemistry',
  'comfort',
  'respect',
  'curiosity',
  'tension',
]
const EDITABLE_STAGES = ['acquaintances', 'warming_up', 'getting_close', 'close', 'sweethearts'] as const
const DEFAULT_THRESHOLDS = Object.fromEntries(RELATIONSHIP_MILESTONES.map((m) => [m.stage, m.at])) as Record<
  (typeof EDITABLE_STAGES)[number] | 'near_strangers',
  number
>
const DEFAULT_STAGE_HINT = EDITABLE_STAGES.map((s) => `${formatRelationshipStage(s)} ${DEFAULT_THRESHOLDS[s]}`).join(', ')

function blankWorld(template?: WorldTemplateId): Omit<WorldCard, 'id' | 'createdAt' | 'updatedAt'> {
  const def = template ? getWorldTemplate(template) : undefined
  return {
    name: 'New World',
    description: def?.description ?? '',
    rules: def?.rules ?? '',
    lorebook: { name: '', entries: [], token_budget: 512, scan_depth: 8 },
    template,
    campaign: { ...DEFAULT_CAMPAIGN, relationships: template === 'dating_sim' || template === 'visual_novel', dating: template === 'dating_sim' },
  }
}

/**
 * A comma-separated list of ids, committed on blur rather than per keystroke. Live filtering against
 * a closed vocabulary would delete each character before the word could become a valid one, so the
 * raw text is held locally and only parsed when the field is left.
 */
function TokenListField({
  label,
  hint,
  value,
  allowed,
  onCommit,
}: {
  label: string
  hint?: string
  value: readonly string[] | undefined
  /** Closed vocabulary to filter against, or `undefined` to accept any non-empty token. */
  allowed?: readonly string[]
  onCommit: (next: string[] | undefined) => void
}) {
  const [raw, setRaw] = useState((value ?? []).join(', '))
  // Re-sync when the row's own value changes from outside (a different entry scrolled into this slot).
  const joined = (value ?? []).join(', ')
  const [lastJoined, setLastJoined] = useState(joined)
  if (joined !== lastJoined) {
    setLastJoined(joined)
    setRaw(joined)
  }
  const commit = () => {
    const tokens = raw
      .split(',')
      .map((t) => t.trim().toLowerCase().replace(/\s+/g, '_'))
      .filter(Boolean)
    const kept = allowed ? tokens.filter((t) => allowed.includes(t)) : tokens
    const unique = [...new Set(kept)]
    setRaw(unique.join(', '))
    onCommit(unique.length ? unique : undefined)
  }
  return <TextField label={label} hint={hint} value={raw} onChange={(e) => setRaw(e.target.value)} onBlur={commit} />
}

export function WorldsView({
  initialWorldId,
  initialTab,
  onConsumedInitial,
}: {
  /** Deep-link into this world's editor on mount (the command palette's "jump to a world"). */
  initialWorldId?: string | null
  /** Paired with `initialWorldId` — old editor tab ids are accepted for deep links. */
  initialTab?: string | null
  onConsumedInitial?: () => void
} = {}) {
  const worlds = useApiQuery('worlds', () => worldsApi.list(), []) ?? []
  const [selected, setSelected] = useState<WorldCard | 'new' | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<WorldTemplateId | undefined>(undefined)
  // Latched into local state the moment a match is found, same reason `pendingTemplate` is local
  // rather than read straight from a prop: `onConsumedInitial` clears the parent's `initialTab` in
  // the same effect that sets `selected`, and React batches both into one re-render — reading the
  // prop directly at `<WorldEditor initialTab={initialTab}>` would see it already cleared by the
  // time `WorldEditor` actually mounts, silently dropping the deep-linked tab.
  const [resolvedTab, setResolvedTab] = useState<string | undefined>(undefined)
  const [showTemplateGallery, setShowTemplateGallery] = useState(false)
  const [showImport, setShowImport] = useState(false)

  useEffect(() => {
    if (!initialWorldId) return
    const match = worlds.find((w) => w.id === initialWorldId)
    if (!match) return
    setSelected(match)
    setResolvedTab(initialTab ?? undefined)
    onConsumedInitial?.()
    // Only re-run when the target id itself changes (or the list finishes loading) — not on every
    // `worlds` refetch, which would otherwise snap back open every time this world's own editor saves.
  }, [initialWorldId, worlds.length])

  if (selected) {
    return (
      <WorldEditor
        world={selected === 'new' ? null : selected}
        initialTemplate={selected === 'new' ? pendingTemplate : undefined}
        initialTab={selected === 'new' ? undefined : resolvedTab}
        onDone={() => setSelected(null)}
      />
    )
  }

  return (
    <ViewShell
      title="Worlds"
      width="wide"
      description="A world is a shared setting: its tone, its rules, its lore, and its scene backgrounds. Any number of characters can live in one; assign a world from the character's editor."
      actions={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            Import pack…
          </Button>
          <Button variant="primary" onClick={() => setShowTemplateGallery(true)}>
            New world
          </Button>
        </div>
      }
    >
      {showImport && (
        <ImportPackDialog
          onClose={() => setShowImport(false)}
          onImported={async (worldId) => {
            setShowImport(false)
            const imported = await worldsApi.get(worldId)
            if (imported) setSelected(imported)
          }}
        />
      )}
      {showTemplateGallery && (
        <WorldTemplateGallery
          onChoose={(template) => {
            setPendingTemplate(template)
            setShowTemplateGallery(false)
            setSelected('new')
          }}
          onClose={() => setShowTemplateGallery(false)}
        />
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4">
        {worlds.map((w) => (
          <button
            key={w.id}
            onClick={() => setSelected(w)}
            className="themed-shadow group rounded-2xl bg-bg-elevated p-3 text-left transition-transform hover:-translate-y-0.5"
          >
            <div className="portrait-frame mb-3 aspect-[4/3] w-full rounded-xl">
              {w.avatarDataUrl ? (
                <img src={w.avatarDataUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-bg-sunken text-text-muted">
                  <Globe size={26} strokeWidth={1.5} />
                </div>
              )}
            </div>
            <div className="truncate px-1 text-sm font-medium text-text">{w.name}</div>
            <div className="truncate px-1 text-xs text-text-muted">
              {w.lorebook.entries.length} {w.lorebook.entries.length === 1 ? 'lore entry' : 'lore entries'}
            </div>
          </button>
        ))}
        {worlds.length === 0 && (
          <EmptyState
            className="col-span-full"
            action={
              <Button variant="primary" onClick={() => setShowTemplateGallery(true)}>
                Create your first world
              </Button>
            }
          >
            No worlds yet. Start from a template (Freeform RP, Visual Novel, Dating Sim, or Slice of
            Life) and reshape it from there.
          </EmptyState>
        )}
      </div>
    </ViewShell>
  )
}

const WORLD_TABS: EditorTab[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'story-rules', label: 'Story Rules' },
  { id: 'canon', label: 'Canon' },
  { id: 'locations', label: 'Locations' },
  { id: 'simulation', label: 'Simulation' },
  { id: 'relationships', label: 'Relationships' },
  { id: 'presentation', label: 'Presentation' },
  { id: 'advanced', label: 'Advanced' },
]

export function worldEditorTabs(modules: WorldModules, canonCount: number): EditorTab[] {
  return WORLD_TABS.filter((tab) =>
    (tab.id !== 'story-rules' || !!modules.campaignRules) &&
    (tab.id !== 'simulation' || modules.worldSimulation) &&
    (tab.id !== 'relationships' || modules.relationships) &&
    (tab.id !== 'presentation' || modules.visualNovel),
  ).map((tab) => tab.id === 'canon' ? { ...tab, badge: canonCount } : tab)
}

export function changeWorldModule<K extends keyof WorldModuleChoices>(
  modules: WorldModuleChoices,
  campaign: CampaignConfig,
  key: K,
  value: WorldModuleChoices[K],
): { modules: WorldModuleChoices; campaign: CampaignConfig } {
  const nextModules = { ...modules, [key]: value }
  if (key === 'campaignRules' && value) return { modules: nextModules, campaign: { ...campaign, mode: value as CampaignConfig['mode'] } }
  if (key === 'relationships') {
    if (!value) nextModules.dating = false
    return { modules: nextModules, campaign: { ...campaign, relationships: !!value, dating: !!value && campaign.dating } }
  }
  if (key === 'dating') return { modules: nextModules, campaign: { ...campaign, dating: !!value } }
  return { modules: nextModules, campaign }
}

export function initialWorldEditorModules(world: Pick<WorldCard, 'template' | 'campaign' | 'modules'>): {
  campaign: CampaignConfig
  modules: WorldModuleChoices
} {
  if (world.campaign) return { campaign: world.campaign, modules: world.modules ?? {} }
  const effective = modulesForWorld(world)
  return {
    campaign: { ...DEFAULT_CAMPAIGN, relationships: effective.relationships, dating: effective.dating },
    modules: { ...world.modules, campaignRules: effective.campaignRules },
  }
}

/** Keep move references and display labels in sync when a sheet field changes. */
export function setCampaignSheetStats(campaign: CampaignConfig, stats: CampaignStat[]): CampaignConfig {
  const nextById = new Map(stats.map((stat) => [stat.id, stat]))
  return {
    ...campaign,
    stats,
    moves: campaign.moves.map((move) => {
      const linked = statForMove(campaign, move)
      if (!linked) return move
      const next = nextById.get(linked.id)
      return { ...move, statId: next?.id, stat: next?.name ?? '' }
    }),
  }
}

/** Loading a rules template should not switch off this world's relationship or dating features. */
export function loadCampaignPreset(current: CampaignConfig, preset: CampaignConfig): CampaignConfig {
  return {
    ...preset,
    relationships: current.relationships,
    dating: current.dating,
    stats: preset.stats?.map((stat) => ({ ...stat })),
    // A rank ladder belongs to the world's setting, not the dice rules, so a preset without one keeps it.
    ranks: (preset.ranks ?? current.ranks)?.map((rank) => ({ ...rank })),
    // Tracked state can outlive the dice rules too (set events and the GM still use it); a preset with its own replaces it.
    tracks: (preset.tracks ?? current.tracks)?.map((track) => ({ ...track })),
    moves: preset.moves.map((move) => ({ ...move })),
  }
}

/**
 * The world's rank ladder, lowest first. Rows keep stable keys across reorders so focus and typing
 * follow the rung being moved; a ladder replaced from outside (preset, import) falls back to
 * positional keys until it's edited here.
 */
function RankLadderEditor({ ranks, onChange }: { ranks: CampaignRank[]; onChange: (ranks: CampaignRank[]) => void }) {
  const [keys, setKeys] = useState<string[]>(() => ranks.map(() => newId()))
  const rowKeys = ranks.map((_, index) => keys[index] ?? `rank-row-${index}`)
  const problem = rankLadderProblem(ranks)

  const move = (index: number, delta: -1 | 1) => {
    const key = rowKeys[index]
    setKeys(moveItem(rowKeys, index, delta))
    onChange(moveItem(ranks, index, delta))
    // The button that was pressed goes disabled when its rung reaches either end; hand focus to the
    // other arrow so a keyboard user can keep going.
    requestAnimationFrame(() => {
      const same = document.getElementById(`${key}-${delta < 0 ? 'up' : 'down'}`) as HTMLButtonElement | null
      const other = document.getElementById(`${key}-${delta < 0 ? 'down' : 'up'}`) as HTMLButtonElement | null
      if (same && !same.disabled) same.focus()
      else other?.focus()
    })
  }
  const update = (index: number, patch: Partial<CampaignRank>) =>
    onChange(ranks.map((rank, i) => {
      if (i !== index) return rank
      const next = { ...rank, ...patch }
      if (!next.note) delete next.note
      return next
    }))
  const remove = (index: number) => {
    setKeys(rowKeys.filter((_, i) => i !== index))
    onChange(ranks.filter((_, i) => i !== index))
  }
  const add = () => {
    if (ranks.length >= MAX_RANKS) return
    setKeys([...rowKeys, newId()])
    onChange([...ranks, { name: nextRankName(ranks) }])
  }

  return (
    <div className="space-y-3">
      {ranks.length === 0 && <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-text-muted">No ranks yet. Without a ladder the Game Master judges difficulty from the scene alone.</p>}
      {ranks.map((rank, index) => {
        const key = rowKeys[index]
        const label = rank.name.trim() || `rank ${index + 1}`
        return <div key={key} className="rounded-xl border border-border bg-bg-sunken p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm text-text">Rank {index + 1}{ranks.length > 1 && index === 0 ? ' · lowest' : ranks.length > 1 && index === ranks.length - 1 ? ' · highest' : ''}</strong>
            <div className="flex items-center gap-1">
              <Button id={`${key}-up`} variant="secondary" aria-label={`Move ${label} up`} title="Move up" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={15} strokeWidth={2} aria-hidden="true" /></Button>
              <Button id={`${key}-down`} variant="secondary" aria-label={`Move ${label} down`} title="Move down" disabled={index === ranks.length - 1} onClick={() => move(index, 1)}><ArrowDown size={15} strokeWidth={2} aria-hidden="true" /></Button>
              <Button variant="secondary" aria-label={`Remove ${label}`} onClick={() => remove(index)}>Remove</Button>
            </div>
          </div>
          <TextField label="Name" maxLength={RANK_NAME_MAX} value={rank.name} onChange={(e) => update(index, { name: e.target.value })} />
          <TextField label="Note (optional)" maxLength={RANK_NOTE_MAX} placeholder="e.g. exceptional status, not a rung" value={rank.note ?? ''} onChange={(e) => update(index, { note: e.target.value })} />
        </div>
      })}
      {problem && <p className="text-xs text-danger">{problem}</p>}
      <Button variant="secondary" disabled={ranks.length >= MAX_RANKS} onClick={add}>Add rank{ranks.length >= MAX_RANKS ? ` (maximum ${MAX_RANKS})` : ''}</Button>
    </div>
  )
}

function WorldEditor({
  world,
  initialTemplate,
  initialTab,
  onDone,
}: {
  world: WorldCard | null
  initialTemplate?: WorldTemplateId
  /** Deep-link straight to one tab on mount (the Relationship panel's "Customize" link). */
  initialTab?: string | null
  onDone: () => void
}) {
  const base = world ?? { id: '', createdAt: 0, updatedAt: 0, ...blankWorld(initialTemplate) }
  const [tab, setTab] = useState<string>(() => WORLD_TAB_ALIASES[initialTab as keyof typeof WORLD_TAB_ALIASES] ?? initialTab ?? 'overview')
  const [name, setName] = useState(base.name)
  const [selectedCampaignPreset, setSelectedCampaignPreset] = useState('')
  const [description, setDescription] = useState(base.description)
  const [artStyle, setArtStyle] = useState(base.artStyle ?? '')
  const [rules, setRules] = useState(base.rules ?? '')
  const [gmNotes, setGmNotes] = useState(base.gmNotes ?? '')
  const [visibility, setVisibility] = useState<Visibility>(base.visibility ?? 'private')
  const [showExport, setShowExport] = useState(false)
  const initialModules = initialWorldEditorModules(base)
  const [campaign, setCampaign] = useState<CampaignConfig>(initialModules.campaign)
  const [modules, setModules] = useState<WorldModuleChoices>(initialModules.modules)
  const [promptItems, setPromptItems] = useState<PromptItem[]>(base.promptItems ?? [])
  const [canonFacts, setCanonFacts] = useState<NonNullable<WorldCard['canonFacts']>>(base.canonFacts ?? [])
  const [openedCanonIds] = useState(() => new Set((base.canonFacts ?? []).map((fact) => fact.id)))
  const [newCanonFact, setNewCanonFact] = useState('')
  const [template, setTemplate] = useState<WorldTemplateId>(normalizeWorldTemplateId(base.template))
  const [lorebook, setLorebook] = useState(base.lorebook)
  const [avatarDataUrl, setAvatarDataUrl] = useState(base.avatarDataUrl)
  const [backgrounds, setBackgrounds] = useState<Record<string, string>>(base.backgrounds ?? {})
  const [backgroundsNight, setBackgroundsNight] = useState<Record<string, string>>(base.backgroundsNight ?? {})
  const [backgroundUnlocks, setBackgroundUnlocks] = useState<Record<string, number>>(base.backgroundUnlocks ?? {})
  const [customBackgrounds, setCustomBackgrounds] = useState<CustomBackground[]>(base.customBackgrounds ?? [])
  const [scenerySet, setScenerySet] = useState<ScenerySetId>(scenerySetFor(base))
  const catalog = backgroundCatalog({ scenerySet })
  /** The opening shot VN mode falls back to whenever a scene has no valid tag of its own. */
  const [defaultBackgroundId, setDefaultBackgroundId] = useState<string | undefined>(base.defaultBackgroundId)
  const [newBackgroundLabel, setNewBackgroundLabel] = useState('')
  const [music, setMusic] = useState<Record<string, string>>(base.music ?? {})
  const [gifts, setGifts] = useState<GiftItem[]>(base.gifts ?? [])
  const [items, setItems] = useState<ItemDef[]>(base.items ?? [])
  const [intimacyOptions, setIntimacyOptions] = useState<IntimacyUnlockable[]>(base.customIntimacyOptions ?? [])
  const [replaceIntimacyCatalog, setReplaceIntimacyCatalog] = useState(base.replaceIntimacyCatalog ?? false)
  const [customSceneFlags, setCustomSceneFlags] = useState<CustomSceneFlag[]>(base.customSceneFlags ?? [])
  const [thresholds, setThresholds] = useState(base.relationshipThresholds ?? {})
  /** `undefined` = inherit the global Settings value; a set value overrides it for every chat in this world. */
  const [intimacyLevel, setIntimacyLevel] = useState<IntimacyDetailLevel | undefined>(base.intimacyLevel ?? undefined)
  const [triggers, setTriggers] = useState<Trigger[]>(base.triggers ?? [])
  const [newTriggerLabel, setNewTriggerLabel] = useState('')
  const [currentDay, setCurrentDay] = useState(base.currentDay ?? 0)
  const [currentPhaseIndex, setCurrentPhaseIndex] = useState(base.currentPhaseIndex ?? 0)
  const [advancing, setAdvancing] = useState(false)
  const [calendar, setCalendar] = useState<WorldCalendar | undefined>(base.calendar)
  const [advanceClockInPlay, setAdvanceClockInPlay] = useState(base.advanceClockInPlay ?? false)
  // "Set today's date": a year, month and day on the calendar being edited.
  const [dateDraft, setDateDraft] = useState<{ year: number; monthIndex: number; dayOfMonth: number } | null>(null)
  const [saving, setSaving] = useState(false)

  const addTrigger = () => {
    const label = newTriggerLabel.trim()
    if (!label) return
    setTriggers((list) => [
      ...list,
      {
        // The id is what "already fired" is remembered by, so it is minted once and never
        // regenerated from the label — renaming a trigger must not make it fire again.
        id: slugifyTriggerId(label, list.map((t) => t.id)),
        label,
        when: [{ kind: 'stat_at_least', stat: 'affection', value: 50 }],
        then: [{ kind: 'notify', text: '' }],
      },
    ])
    setNewTriggerLabel('')
  }

  const updateTrigger = (id: string, patch: Partial<Trigger>) =>
    setTriggers((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))

  const save = async () => {
    setSaving(true)
    // The world clock (currentDay/currentPhaseIndex) is deliberately excluded — this editor only
    // reads it once at mount for display; a live chat advances the real clock independently, and
    // sending the stale mount-time snapshot here would roll it back.
    const payload = {
      name,
      description,
      artStyle,
      rules,
      gmNotes,
      campaign,
      modules,
      promptItems,
      canonFacts,
      template,
      lorebook,
      avatarDataUrl,
      backgrounds,
      backgroundsNight,
      backgroundUnlocks,
      customBackgrounds,
      scenerySet,
      // `null`, not `undefined` — see the `intimacyLevel` comment below on why a cleared nullable
      // field has to be sent explicitly rather than just omitted.
      defaultBackgroundId: defaultBackgroundId ?? null,
      music,
      gifts,
      items,
      customIntimacyOptions: intimacyOptions,
      replaceIntimacyCatalog,
      customSceneFlags,
      relationshipThresholds: thresholds,
      // `null`, not `undefined`, for "inherit the global setting" — `JSON.stringify` drops an
      // undefined-valued key, so the server would never see the field and an existing rating
      // would survive being cleared. Same reason `Chat.activeEvent`/`authorNote` use null.
      intimacyLevel: intimacyLevel ?? null,
      triggers,
      // `null` clears a calendar the world no longer uses (an omitted key would keep it).
      calendar: calendar ?? null,
      advanceClockInPlay,
      visibility,
    }
    try {
      if (world) {
        // A chat can commit a world fact while this editor is open. Keep those new facts when
        // saving unrelated world settings, while respecting removals made in this editor.
        const latest = await worldsApi.get(world.id)
        const addedElsewhere = (latest?.canonFacts ?? []).filter((fact) => !openedCanonIds.has(fact.id))
        await worldsApi.update(world.id, { ...payload, canonFacts: [...canonFacts, ...addedElsewhere] })
      }
      else await worldsApi.create(payload)
    } catch (e) {
      toastError(errorMessage(e))
      return
    } finally {
      setSaving(false)
    }
    onDone()
  }

  const addGift = () =>
    setGifts((g) => [...g, { id: newId(), name: `Gift ${g.length + 1}`, rarity: 'common', price: 5, tags: [] }])
  const updateGift = (id: string, patch: Partial<GiftItem>) =>
    setGifts((g) => g.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  const removeGift = (id: string) => setGifts((g) => g.filter((item) => item.id !== id))

  const addIntimacyOption = () =>
    setIntimacyOptions((list) => [...list, { id: newId(), category: 'activity', label: 'New idea', minWarmth: 50 }])
  const updateIntimacyOption = (id: string, patch: Partial<IntimacyUnlockable>) =>
    setIntimacyOptions((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  const removeIntimacyOption = (id: string) => setIntimacyOptions((list) => list.filter((o) => o.id !== id))

  const addItem = () =>
    setItems((list) => [
      ...list,
      {
        id: newId(),
        name: `Item ${list.length + 1}`,
        rarity: 'common',
        price: 5,
        tags: [],
        effect: { kind: 'relationship', dimension: 'affection', amount: 1 },
      },
    ])
  const updateItem = (id: string, patch: Partial<ItemDef>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  /** Switching effect kind replaces the effect wholesale so no stale field from the old kind lingers in what's saved. */
  const setItemEffectKind = (id: string, kind: ItemEffect['kind']) => {
    const next: ItemEffect =
      kind === 'flag'
        ? { kind: 'flag', flag: 'first_date' }
        : kind === 'currency'
          ? { kind: 'currency', amount: 5 }
          : { kind: 'relationship', dimension: 'affection', amount: 1 }
    updateItem(id, { effect: next })
  }
  const setItemEffectField = (id: string, patch: Partial<ItemEffect>) =>
    setItems((list) => list.map((i) => (i.id === id ? { ...i, effect: { ...i.effect, ...patch } as ItemEffect } : i)))
  const removeItem = (id: string) => setItems((list) => list.filter((i) => i.id !== id))

  const addCustomSceneFlag = () =>
    setCustomSceneFlags((list) => [...list, { id: newId(), label: `Flag ${list.length + 1}`, description: '' }])
  const updateCustomSceneFlag = (id: string, patch: Partial<CustomSceneFlag>) =>
    setCustomSceneFlags((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  const removeCustomSceneFlag = (id: string) => {
    setCustomSceneFlags((list) => list.filter((f) => f.id !== id))
    // Fall any item pointing at the removed flag back to a default, so it isn't left with a dead reference.
    setItems((list) =>
      list.map((i) => (i.effect.kind === 'flag' && i.effect.flag === id ? { ...i, effect: { kind: 'flag', flag: 'first_date' } } : i)),
    )
  }

  const setThreshold = (stage: (typeof EDITABLE_STAGES)[number], value: string) => {
    setThresholds((t) => {
      const next = { ...t }
      if (value.trim() === '') delete next[stage]
      else next[stage] = Math.max(0, Math.min(100, Number(value) || 0))
      return next
    })
  }

  const handleBackgroundPick = async (tagId: string, file: File) => {
    setBackgrounds((b) => ({ ...b, [tagId]: '' }))
    const dataUrl = await fileToDataUrl(file)
    setBackgrounds((b) => ({ ...b, [tagId]: dataUrl }))
  }
  const handleBackgroundNightPick = async (tagId: string, file: File) => {
    setBackgroundsNight((b) => ({ ...b, [tagId]: '' }))
    const dataUrl = await fileToDataUrl(file)
    setBackgroundsNight((b) => ({ ...b, [tagId]: dataUrl }))
  }
  const removeBackgroundNight = (tagId: string) =>
    setBackgroundsNight((b) => {
      const next = { ...b }
      delete next[tagId]
      return next
    })
  /**
   * Bulk background upload: pick every location's day/night art at once, matched to a slot by
   * filename — `park_day.png`/`park_night.png` -> the `park` location (bare `park.png` is treated
   * as the day image, for a location with no separate night variant yet). Same pattern as
   * `CharacterEditor.tsx`'s `handleBulkSpritePick`.
   */
  const handleBulkBackgroundPick = async (files: FileList) => {
    const knownIds = new Set([...catalog.map((b) => b.id), ...customBackgrounds.map((b) => b.id)])
    const matched: string[] = []
    const unmatched: string[] = []
    const dayUpdates: Record<string, string> = {}
    const nightUpdates: Record<string, string> = {}
    for (const file of Array.from(files)) {
      const baseName = file.name.replace(/\.[^.]+$/, '').toLowerCase().trim()
      const nightMatch = baseName.match(/^(.+)_night$/)
      const dayMatch = baseName.match(/^(.+)_day$/)
      const id = nightMatch?.[1] ?? dayMatch?.[1] ?? baseName
      if (!knownIds.has(id)) {
        unmatched.push(file.name)
        continue
      }
      const dataUrl = await fileToDataUrl(file)
      if (nightMatch) nightUpdates[id] = dataUrl
      else dayUpdates[id] = dataUrl
      matched.push(file.name)
    }
    if (Object.keys(dayUpdates).length > 0) setBackgrounds((b) => ({ ...b, ...dayUpdates }))
    if (Object.keys(nightUpdates).length > 0) setBackgroundsNight((b) => ({ ...b, ...nightUpdates }))
    if (matched.length > 0) toastSuccess(`Matched ${matched.length} background image${matched.length === 1 ? '' : 's'}`)
    if (unmatched.length > 0) toastError(`No matching location for: ${unmatched.join(', ')}. Rename to "<id>_day.png"/"<id>_night.png", or add a custom location with that id first.`)
  }
  const handleMusicPick = async (key: string, file: File) => {
    const dataUrl = await fileToDataUrl(file)
    setMusic((m) => ({ ...m, [key]: dataUrl }))
  }
  const removeMusic = (key: string) =>
    setMusic((m) => {
      const next = { ...m }
      delete next[key]
      return next
    })
  const removeBackground = (tagId: string) => {
    setBackgrounds((b) => {
      const next = { ...b }
      delete next[tagId]
      return next
    })
    setBackgroundUnlocks((b) => {
      const next = { ...b }
      delete next[tagId]
      return next
    })
    removeBackgroundNight(tagId)
  }
  const setDefaultBackground = (tagId: string) => setDefaultBackgroundId((cur) => (cur === tagId ? undefined : tagId))
  const setBackgroundUnlock = (tagId: string, minAffection: number) =>
    setBackgroundUnlocks((b) => ({ ...b, [tagId]: Math.max(0, Math.min(100, minAffection)) }))

  /** World-authored scene locations beyond the 12 defaults — same "author extends a fixed set" pattern as `addCustomExpression` in `CharacterEditor.tsx`. */
  const addCustomBackground = () => {
    const label = newBackgroundLabel.trim()
    if (!label) return
    const existingIds = [...catalog.map((b) => b.id), ...customBackgrounds.map((b) => b.id)]
    setCustomBackgrounds((list) => [...list, { id: slugifyBackgroundId(label, existingIds), label }])
    setNewBackgroundLabel('')
  }
  const removeCustomBackground = (backgroundId: string) => {
    setCustomBackgrounds((list) => list.filter((b) => b.id !== backgroundId))
    removeBackground(backgroundId)
    setDefaultBackgroundId((cur) => (cur === backgroundId ? undefined : cur))
  }

  const advanceClock = async () => {
    if (!world || advancing) return
    setAdvancing(true)
    const next = advancePhase(currentDay, currentPhaseIndex)
    try {
      await worldsApi.update(world.id, { currentDay: next.day, currentPhaseIndex: next.phaseIndex })
    } catch (e) {
      toastError(errorMessage(e))
      return
    } finally {
      setAdvancing(false)
    }
    setCurrentDay(next.day)
    setCurrentPhaseIndex(next.phaseIndex)
  }

  /** Moves the world clock to a chosen date, keeping the time of day. Saves the calendar too, since the date is read on it. */
  const setClockDate = async () => {
    if (!world || !dateDraft || advancing) return
    const day = dayForDate(calendar, dateDraft)
    setAdvancing(true)
    try {
      await worldsApi.update(world.id, { currentDay: day, calendar: calendar ?? null } as Partial<WorldCard>)
      setCurrentDay(day)
      setDateDraft(null)
    } catch (e) {
      toastError(errorMessage(e))
    } finally {
      setAdvancing(false)
    }
  }

  const remove = async () => {
    if (!world) return
    const ok = await confirmDialog({
      title: `Delete "${world.name}"?`,
      body: 'Characters living here are un-assigned, not deleted. This cannot be undone.',
      confirmLabel: 'Delete world',
      tone: 'danger',
    })
    if (!ok) return
    await worldsApi.remove(world.id)
    onDone()
  }

  const effectiveModules = modulesForWorld({ template, campaign, modules })
  const tabs = worldEditorTabs(effectiveModules, lorebook.entries.length + canonFacts.length)
  const sheetStats = campaignStats(campaign)
  const customTiers = campaign.resolver === 'custom' && campaign.custom ? tierLabels(campaign.custom) : undefined
  const sheetNames = sheetStats.map((stat) => stat.name.trim().toLowerCase())
  const sheetStatsValid = sheetStats.length <= 30 && sheetNames.every(Boolean) && new Set(sheetNames).size === sheetNames.length
  const rankLadderValid = !rankLadderProblem(campaign.ranks ?? [])
  const tracksValid = !tracksProblem(campaign.tracks ?? [])

  const addSheetStat = () => {
    if (sheetStats.length >= 30) return
    let number = sheetStats.length + 1
    while (sheetNames.includes(`stat ${number}`)) number++
    setCampaign(setCampaignSheetStats(campaign, [...sheetStats, { id: newId(), name: `Stat ${number}`, valueMode: campaign.resolver === 'roll-under' ? 'target' : 'modifier' }]))
  }

  const updateSheetStat = (id: string, patch: Partial<CampaignStat>) =>
    setCampaign(setCampaignSheetStats(campaign, sheetStats.map((stat) => stat.id === id ? { ...stat, ...patch } : stat)))

  const removeSheetStat = (id: string) =>
    setCampaign(setCampaignSheetStats(campaign, sheetStats.filter((stat) => stat.id !== id)))

  const setModule = <K extends keyof WorldModuleChoices>(key: K, value: WorldModuleChoices[K]) => {
    const next = changeWorldModule(modules, campaign, key, value)
    setModules(next.modules)
    setCampaign(next.campaign)
  }

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab('overview')
  }, [tab, effectiveModules.campaignRules, effectiveModules.worldSimulation, effectiveModules.relationships, effectiveModules.visualNovel])

  const allBackgrounds = [
    ...catalog.map((b) => ({ id: b.id, label: b.label, custom: false })),
    // Art already uploaded under another set's id stays visible and editable after switching sets.
    ...Object.keys(backgrounds)
      .filter((id) => !catalog.some((b) => b.id === id) && !customBackgrounds.some((b) => b.id === id))
      .map((id) => ({ id, label: backgroundLabel(id), custom: false })),
    ...customBackgrounds.map((b) => ({ id: b.id, label: b.label, custom: true })),
  ]

  return (
    <EditorShell
      onBack={onDone}
      backLabel="Worlds"
      eyebrow="World"
      title={name || 'Untitled world'}
      tabs={tabs}
      activeTab={tab}
      onTabChange={setTab}
      footer={
        <>
          {world ? (
            <div className="flex gap-2">
              <Button variant="danger" onClick={remove}>
                Delete world
              </Button>
              <Button variant="secondary" onClick={() => setShowExport(true)}>
                Export pack…
              </Button>
            </div>
          ) : (
            <span />
          )}
          <Button variant="primary" onClick={save} disabled={!name.trim() || !sheetStatsValid || !rankLadderValid || !tracksValid || saving}>
            {saving ? 'Saving…' : world ? 'Save changes' : 'Create world'}
          </Button>
        </>
      }
    >
      {showExport && world && <ExportPackDialog world={world} onClose={() => setShowExport(false)} />}
      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="flex items-start gap-4">
            <label
              className="portrait-frame group relative flex h-24 w-32 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border bg-bg-sunken"
              aria-label="Change cover image"
            >
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="" className="h-full w-full rounded-xl object-cover" />
              ) : (
                <span className="flex flex-col items-center gap-1 text-[11px] text-text-muted">
                  <ImagePlus size={18} strokeWidth={1.5} />
                  Cover
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
          <VisibilityField value={visibility} row={world ?? undefined} onChange={setVisibility} />

          <TextAreaField
            label="Description"
            hint="Setting, tone, atmosphere. Always included for any character living here."
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <TextField
            label="Art style"
            hint="How generated pictures of this world look, e.g. watercolor, muted colors. Added to image prompts."
            value={artStyle}
            maxLength={300}
            onChange={(e) => setArtStyle(e.target.value)}
          />
          <TextAreaField
            label="Rules"
            hint="Hard constraints the model should never contradict. Magic system, tech level, taboos."
            rows={3}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
          <div>
            <div className="mb-1.5 text-sm text-text">Template</div>
            <p className="mb-2 text-xs text-text-muted">
              Sets the starting style and romance emphasis. The module switches below choose which tools this world uses; switching one off keeps its saved content.
            </p>
            <div className="flex flex-wrap gap-2">
              {WORLD_TEMPLATES.map((t) => (
                <Chip key={t.id} on={template === t.id} onClick={() => setTemplate(t.id)}>
                  {t.label}
                </Chip>
              ))}
            </div>
          </div>
          <Section title="World modules" description="Choose the tools this world uses. Turning one off keeps its settings for later." surface="bare">
            <SelectField label="Story rules" value={effectiveModules.campaignRules || 'off'} onChange={(e) => setModule('campaignRules', e.target.value === 'off' ? false : e.target.value as CampaignConfig['mode'])}>
              <option value="off">Off</option>
              <option value="guided">Guided outcomes</option>
              <option value="mechanical">Roll for outcomes</option>
            </SelectField>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={effectiveModules.relationships} onChange={(e) => setModule('relationships', e.target.checked)} /> Relationships</label>
              <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={effectiveModules.dating} disabled={!effectiveModules.relationships} onChange={(e) => setModule('dating', e.target.checked)} /> Dating tools</label>
              <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={effectiveModules.visualNovel} onChange={(e) => setModule('visualNovel', e.target.checked)} /> Visual novel presentation</label>
              <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={effectiveModules.worldSimulation} onChange={(e) => setModule('worldSimulation', e.target.checked)} /> World simulation</label>
            </div>
            <p className="mt-3 text-xs text-text-muted">Romance emphasis: {effectiveModules.romanceEmphasis}. Change the template or dating tools to adjust it.</p>
          </Section>
        </div>
      )}

      {tab === 'story-rules' && (
        <div className="space-y-6">
          <Section title="Story rules" description="Choose how outcomes are decided for this world. Existing chats in this world use these settings." surface="bare">
            <p className="mb-3 text-xs text-text-muted">Presets cover core checks. You can edit their fields and moves for this world. Loading a preset replaces the current rules and sheet builder fields.</p>
            <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <SelectField label="Ruleset preset" value={selectedCampaignPreset} onChange={(e) => setSelectedCampaignPreset(e.target.value)}>
                <option value="">Choose a preset</option>
                {CAMPAIGN_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </SelectField>
              <Button variant="secondary" disabled={!selectedCampaignPreset} onClick={() => {
                const preset = CAMPAIGN_PRESETS.find((entry) => entry.id === selectedCampaignPreset)
                if (!preset) return
                const next = loadCampaignPreset(campaign, preset.campaign)
                setCampaign(next)
                setModules((current) => ({ ...current, campaignRules: next.mode }))
              }}>Load preset</Button>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              <FileButton
                accept=".json,application/json"
                title="Replace these rules with a campaign file exported from this or another world"
                onPick={async (files) => {
                  try {
                    const next = parseCampaignFile(await files[0].text())
                    setCampaign(next)
                    setModules((current) => ({ ...current, campaignRules: next.mode, relationships: next.relationships, dating: next.dating }))
                    toastSuccess('Campaign loaded. Save the world to keep it.')
                  } catch (e) {
                    toastError(errorMessage(e))
                  }
                }}
              >
                Import campaign file
              </FileButton>
              <Button
                variant="secondary"
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([campaignFileFrom(campaign)], { type: 'application/json' }))
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${campaign.ruleset.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'campaign'}.campaign.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Export campaign file
              </Button>
            </div>
            <TextField label="Ruleset" value={campaign.ruleset} onChange={(e) => setCampaign({ ...campaign, ruleset: e.target.value })} />
            <TextField label="Version or edition" value={campaign.edition ?? ''} onChange={(e) => setCampaign({ ...campaign, edition: e.target.value })} />
            <SelectField label="Check resolver" value={campaign.resolver} onChange={(e) => setCampaign({ ...campaign, resolver: e.target.value as CampaignConfig['resolver'] })} hint="Choose how the engine rolls and decides success. Changing this does not convert saved character sheets.">
              <option value="pbta">PbtA · 2d6 tiers</option>
              <option value="d20">D20 · pass or fail</option>
              <option value="d20-degree">D20 · four degrees</option>
              <option value="fate">Fate · four Fate dice</option>
              <option value="roll-under">3d6 · roll under</option>
              <option value="custom" disabled={!campaign.custom}>{campaign.custom ? 'Custom · this world\'s own dice' : 'Custom · draft one in Writer\'s Room'}</option>
            </SelectField>
            {campaign.resolver === 'custom' && campaign.custom && <div className="mb-4 rounded-lg border border-border bg-bg-sunken p-3 text-xs text-text-muted">
              <p className="mb-1 text-text">{describeDice(campaign.custom.dice)}</p>
              <ul className="list-disc space-y-0.5 pl-4">{describeBands(campaign.custom).map((line) => <li key={line}>{line}</li>)}</ul>
              <p className="mt-2">To change these rules, ask Writer's Room.</p>
            </div>}
            <div className="mb-4 flex flex-wrap gap-2">
              <Chip on={campaign.mode === 'guided'} onClick={() => setModule('campaignRules', 'guided')}>Guided outcomes</Chip>
              <Chip on={campaign.mode === 'mechanical'} onClick={() => setModule('campaignRules', 'mechanical')}>Roll for outcomes</Chip>
            </div>
            <p className="mb-4 text-xs text-text-muted">Guided mode uses the ruleset as story guidance. Mechanical mode records a {campaign.resolver === 'custom' ? 'custom' : campaign.resolver === 'pbta' ? '2d6' : campaign.resolver === 'fate' ? 'four Fate dice' : campaign.resolver === 'roll-under' ? '3d6' : 'd20'} check before the narrator describes it. The player chooses when to roll.</p>
            <TextAreaField label="Game Master continuity notes" hint="Only the Game Master sees these. Record secrets, relationship visibility, and future story threads here; character agents receive only what their own cards and public lore permit." rows={6} value={gmNotes} onChange={(e) => setGmNotes(e.target.value)} />
            <label className="mb-3 flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={effectiveModules.relationships} onChange={(e) => setModule('relationships', e.target.checked)} /> Use RP relationship scoring</label>
            <label className="flex items-center gap-2 text-sm text-text"><input type="checkbox" checked={effectiveModules.dating} disabled={!effectiveModules.relationships} onChange={(e) => setModule('dating', e.target.checked)} /> Enable dating features</label>
          </Section>
          <Section title="Character sheet builder" description="Define the fields characters in this world can have. Set each character’s values on their sheet, then choose which field each move checks." surface="bare">
            <div className="space-y-3">
              {sheetStats.map((stat) => <div key={stat.id} className="rounded-xl border border-border bg-bg-sunken p-4">
                <div className="mb-3 flex items-center justify-between gap-2"><strong className="text-sm text-text">Sheet stat</strong><Button variant="secondary" onClick={() => removeSheetStat(stat.id)}>Remove</Button></div>
                <TextField label="Name" maxLength={100} value={stat.name} onChange={(e) => updateSheetStat(stat.id, { name: e.target.value })} />
                <TextField label="Description (optional)" maxLength={500} value={stat.description ?? ''} onChange={(e) => updateSheetStat(stat.id, { description: e.target.value })} />
                <SelectField label="Value type" value={stat.valueMode ?? 'modifier'} onChange={(e) => updateSheetStat(stat.id, { valueMode: e.target.value as CampaignStat['valueMode'] })}>
                  <option value="modifier">Modifier or skill bonus</option>
                  <option value="ability">Ability score</option>
                  <option value="target">Roll-under target</option>
                </SelectField>
              </div>)}
              {!sheetStatsValid && <p className="text-xs text-danger">Give each stat a unique, nonempty name before saving.</p>}
              <Button variant="secondary" disabled={sheetStats.length >= 30} onClick={addSheetStat}>Add stat{sheetStats.length >= 30 ? ' (maximum 30)' : ''}</Button>
            </div>
          </Section>
          <Section title="Rank ladder" description="Lowest first. The Game Master judges what's routine, what needs a roll, and what's out of reach by each character's rank. Use a note for a rank outside the order, like an exceptional status." surface="bare">
            {/* Always an array once edited, so clearing the last rung saves `[]` and the server drops the old ladder. */}
            <RankLadderEditor ranks={campaign.ranks ?? []} onChange={(ranks) => setCampaign({ ...campaign, ranks })} />
          </Section>
          <Section title="Tracked state" description="What play keeps count of: resources to spend, conditions, clocks that fill toward trouble, and item lists. Moves and set events change them by rule, and the Game Master sees them." surface="bare">
            {/* Always an array once edited, so removing the last one saves `[]` and the server drops the old list. */}
            <TracksEditor tracks={campaign.tracks ?? []} onChange={(tracks) => setCampaign({ ...campaign, tracks })} onRemove={(id) => setCampaign(removeTrack(campaign, id))} />
          </Section>
          <Section title="Moves" description="These are editable campaign checks. Write the trigger and guidance for each result. Degree-specific effects beyond these core checks need custom rules." surface="bare">
            <div className="space-y-4">
              {campaign.moves.map((move, index) => {
                const update = (patch: Partial<PbtaMove>) => setCampaign({ ...campaign, stats: sheetStats, moves: campaign.moves.map((entry) => entry.id === move.id ? { ...entry, ...patch } : entry) })
                return <div key={move.id} className="rounded-xl border border-border bg-bg-sunken p-4">
                  <div className="mb-3 flex items-center justify-between gap-2"><strong className="text-sm text-text">Move {index + 1}</strong><Button variant="secondary" onClick={() => setCampaign({ ...campaign, stats: sheetStats, moves: campaign.moves.filter((entry) => entry.id !== move.id) })}>Remove</Button></div>
                  <TextField label="Name" value={move.name} onChange={(e) => update({ name: e.target.value })} />
                  <TextField label="When you..." value={move.trigger} onChange={(e) => update({ trigger: e.target.value })} />
                  <SelectField label="Roll with stat" value={statForMove(campaign, move)?.id ?? ''} onChange={(e) => {
                    const stat = sheetStats.find((entry) => entry.id === e.target.value)
                    update({ statId: stat?.id, stat: stat?.name ?? '' })
                  }}>
                    <option value="">Choose a sheet stat</option>
                    {sheetStats.map((stat) => <option key={stat.id} value={stat.id}>{stat.name}</option>)}
                  </SelectField>
                  {campaignNeedsTarget(campaign) && <NumberField label="Fixed target / opposition (optional)" hint="Leave blank for the GM or player to set a scene target before rolling." min={-30} max={100} step={1} value={move.target ?? ''} onChange={(e) => {
                    const value = e.target.value === '' ? undefined : Number(e.target.value)
                    if (value === undefined || Number.isInteger(value) && value >= -30 && value <= 100) update({ target: value })
                  }} />}
                  <TextAreaField label={customTiers ? `${customTiers.strong} result` : campaign.resolver === 'pbta' ? '10+ result' : 'Success result'} value={move.strong} onChange={(e) => update({ strong: e.target.value })} />
                  <TextAreaField label={customTiers ? `${customTiers.mixed} result` : campaign.resolver === 'pbta' ? '7–9 result' : 'Tie or complication result'} value={move.mixed} onChange={(e) => update({ mixed: e.target.value })} />
                  <TextAreaField label={customTiers ? `${customTiers.miss} result` : campaign.resolver === 'pbta' ? '6 or less result' : 'Failure result'} value={move.miss} onChange={(e) => update({ miss: e.target.value })} />
                  {!!campaign.tracks?.length && <div className="space-y-2">
                    <p className="text-xs text-text-muted">What each result changes, e.g. "Supplies -1, Hurt on, Trouble +1". Items: "Gear + rope".</p>
                    {(['strong', 'mixed', 'miss'] as const).map((tier) => <EffectsField key={tier} tracks={campaign.tracks!}
                      label={`Changes on ${customTiers ? customTiers[tier] : campaign.resolver === 'pbta' ? { strong: '10+', mixed: '7–9', miss: '6 or less' }[tier] : { strong: 'success', mixed: 'a tie or complication', miss: 'failure' }[tier]}`}
                      effects={move.effects?.[tier]}
                      onChange={(effects) => {
                        const { [tier]: _old, ...others } = move.effects ?? {}
                        const next = effects ? { ...others, [tier]: effects } : others
                        update({ effects: Object.keys(next).length ? next : undefined })
                      }} />)}
                    <ChoiceEffectsField label="When a result lets the player choose, what each option costs" entries={move.choiceEffects} tracks={campaign.tracks} onChange={(choiceEffects) => update({ choiceEffects })} />
                  </div>}
                </div>
              })}
              <Button variant="secondary" onClick={() => setCampaign({ ...campaign, stats: sheetStats, moves: [...campaign.moves, { id: newId(), name: 'New move', trigger: '', stat: sheetStats[0]?.name ?? '', statId: sheetStats[0]?.id, strong: '', mixed: '', miss: '' }] })}>Add move</Button>
            </div>
          </Section>
        </div>
      )}

      {tab === 'advanced' && (
        <Section title="World prompts" description="Ordered instructions shared by every character in this world." surface="bare">
          <PromptItemsEditor items={promptItems} onChange={setPromptItems} />
        </Section>
      )}

      {tab === 'canon' && (
        <div className="space-y-8">
        <Section
          title="World lore"
          description="Keyword- or always-on entries about this setting, shared by every character living here."
          surface="bare"
        >
          <LorebookEditor
            book={lorebook}
            onChange={setLorebook}
            aiContext={{ name, description, extra: rules ? `World rules: ${rules}` : undefined }}
          />
        </Section>
          <Section title="World canon" description="Confirmed facts shared by every chat in this world. Add only events that truly happened in the campaign." surface="bare">
            <div className="space-y-2">
              {canonFacts.map((fact) => <div key={fact.id} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm text-text"><span className="flex-1">{fact.text}</span><button type="button" className="text-danger" aria-label="Remove world fact" onClick={() => setCanonFacts(canonFacts.filter((item) => item.id !== fact.id))}>Remove</button></div>)}
              <TextAreaField label="New canon fact" value={newCanonFact} onChange={(e) => setNewCanonFact(e.target.value)} rows={2} />
              <Button variant="secondary" disabled={!newCanonFact.trim()} onClick={() => { setCanonFacts([...canonFacts, { id: newId(), text: newCanonFact.trim(), createdAt: Date.now() }]); setNewCanonFact('') }}>Add fact</Button>
            </div>
          </Section>
        </div>
      )}

      {tab === 'locations' && (
        <div className="space-y-10">
        <Section
          title="Scene backgrounds"
          description="Art per location for Visual Novel mode. The model tags each reply's setting; anything left blank falls back to a placeholder gradient."
          surface="bare"
        >
          <p className="mb-2 text-xs text-text-muted">
            {Object.keys(backgrounds).length}/{allBackgrounds.length} set. The number under each is
            the warmth needed before that background can appear. The <Star size={11} strokeWidth={2} className="mb-0.5 inline text-accent" />{' '}
            marks the opening scene. Where a new chat starts before the model (or nothing, if
            there's no model connected) has tagged one of its own. The small moon toggle on each
            tile switches it to a night variant, shown automatically once the world clock (Simulation tab)
            reaches evening or night. Leave it unset to always show the day art.
          </p>
          <div className="mb-4">
            <div className="mb-1.5 text-sm text-text">Built-in places</div>
            <div className="flex flex-wrap gap-2">
              {SCENERY_SETS.map((set) => (
                <Chip key={set.id} on={scenerySet === set.id} onClick={() => setScenerySet(set.id)}>
                  {set.label}
                </Chip>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              {SCENERY_SETS.find((set) => set.id === scenerySet)?.description} Your own places below are always offered too.
            </p>
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <FileButton onPick={handleBulkBackgroundPick} accept="image/png,image/jpeg,image/webp" multiple>
              <Plus size={14} strokeWidth={2} />
              Bulk upload by filename
            </FileButton>
            <span className="text-[11px] text-text-muted">e.g. {catalog[0]?.id ?? 'guild-hall'}_day.png + {catalog[0]?.id ?? 'guild-hall'}_night.png → {catalog[0]?.label ?? 'Guild hall'}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {allBackgrounds.map((bg) => (
              <div key={bg.id} className="group relative space-y-1.5">
                <label className="portrait-frame relative block aspect-video cursor-pointer overflow-hidden rounded-xl border border-dashed border-border bg-bg-sunken">
                  {backgrounds[bg.id] ? (
                    <img src={backgrounds[bg.id]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center gap-1 text-[11px] text-text-muted">
                      <ImagePlus size={14} strokeWidth={1.5} />
                      {bg.label}
                    </span>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleBackgroundPick(bg.id, e.target.files[0])}
                  />
                  {(bg.custom || backgrounds[bg.id]) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault()
                        bg.custom ? removeCustomBackground(bg.id) : removeBackground(bg.id)
                      }}
                      aria-label={bg.custom ? `Remove custom location ${bg.label}` : `Remove ${bg.label} background`}
                      className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-lg bg-bg-elevated/90 text-text-muted hover:text-danger group-hover:flex"
                    >
                      ✕
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault()
                      setDefaultBackground(bg.id)
                    }}
                    aria-pressed={defaultBackgroundId === bg.id}
                    aria-label={
                      defaultBackgroundId === bg.id
                        ? `Unset ${bg.label} as the opening scene`
                        : `Set ${bg.label} as the opening scene`
                    }
                    className={`absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-bg-elevated/90 transition-opacity ${
                      defaultBackgroundId === bg.id
                        ? 'text-accent opacity-100'
                        : 'text-text-muted opacity-0 hover:text-accent group-hover:opacity-100'
                    }`}
                  >
                    <Star size={13} strokeWidth={2} fill={defaultBackgroundId === bg.id ? 'currentColor' : 'none'} />
                  </button>
                </label>
                <div className="absolute bottom-8 right-1.5 hidden group-hover:block">
                  <GenerateImageButton
                    purpose="background"
                    label={`Generate ${bg.label} with AI`}
                    initialPrompt={description ? `${bg.label}, ${description}`.slice(0, 300) : `${bg.label}, ${name || 'a scene'}`}
                    onGenerated={(dataUrl) => setBackgrounds((b) => ({ ...b, [bg.id]: dataUrl }))}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 px-0.5">
                  <span className="truncate text-[11px] text-text-muted">{bg.label}</span>
                  <div className="flex items-center gap-1">
                    <label
                      title={backgroundsNight[bg.id] ? `Replace ${bg.label}'s night art` : `Add night art for ${bg.label}`}
                      className={`relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-md ${
                        backgroundsNight[bg.id] ? 'bg-accent/20 text-accent' : 'bg-bg-sunken text-text-muted hover:text-text'
                      }`}
                    >
                      <Moon size={12} strokeWidth={2} fill={backgroundsNight[bg.id] ? 'currentColor' : 'none'} />
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="hidden"
                        onChange={(e) => e.target.files?.[0] && handleBackgroundNightPick(bg.id, e.target.files[0])}
                      />
                    </label>
                    {backgroundsNight[bg.id] && (
                      <button
                        type="button"
                        onClick={() => removeBackgroundNight(bg.id)}
                        aria-label={`Remove ${bg.label}'s night art`}
                        className="flex h-6 w-6 items-center justify-center rounded-md bg-bg-sunken text-text-muted hover:text-danger"
                      >
                        <X size={11} strokeWidth={2.5} />
                      </button>
                    )}
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={Number(backgroundUnlocks[bg.id] ?? 0)}
                      onChange={(e) => setBackgroundUnlock(bg.id, Number(e.target.value) || 0)}
                      className="w-12 rounded-md bg-bg-sunken px-1.5 py-0.5 text-center text-[11px] text-text outline-none"
                      aria-label={`Unlock warmth for ${bg.label}`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <input
              value={newBackgroundLabel}
              onChange={(e) => setNewBackgroundLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addCustomBackground()}
              placeholder="Custom location (e.g. Her family)'s bookshop"
              className="flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
            />
            <Button onClick={addCustomBackground} disabled={!newBackgroundLabel.trim()} className="flex items-center gap-1.5">
              <Plus size={14} strokeWidth={2} />
              Add
            </Button>
          </div>
        </Section>
        </div>
      )}

      {tab === 'presentation' && (
        <div className="space-y-8">
        <Section
          title="Background music"
          description="One looping track per scene mood, for Visual Novel mode. The model tags each reply's mood; the matching track crossfades in. “Default” plays whenever nothing more specific applies. Set at least that one. Turn playback on with the volume slider in Settings → Appearance."
          surface="bare"
        >
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[{ id: BGM_DEFAULT_KEY, label: 'Default', hint: 'The fallback loop. Plays when no mood-specific track is set or tagged' }, ...SCENE_MOODS].map(
              (slot) => (
                <div
                  key={slot.id}
                  className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
                    music[slot.id] ? 'border-accent/40 bg-accent/5' : 'border-dashed border-border'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm text-text">
                      {music[slot.id] ? <Music size={13} strokeWidth={2} className="shrink-0 text-accent" /> : null}
                      {slot.label}
                    </div>
                    <p className="truncate text-[11px] text-text-muted">{slot.hint}</p>
                  </div>
                  <label className="shrink-0 cursor-pointer rounded-lg bg-bg-sunken px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:text-text">
                    {music[slot.id] ? 'Replace' : 'Upload'}
                    <input
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleMusicPick(slot.id, e.target.files[0])}
                    />
                  </label>
                  {music[slot.id] && (
                    <button
                      type="button"
                      onClick={() => removeMusic(slot.id)}
                      aria-label={`Remove ${slot.label} music`}
                      className="shrink-0 text-text-muted hover:text-danger"
                    >
                      <X size={14} strokeWidth={2} />
                    </button>
                  )}
                </div>
              ),
            )}
          </div>
        </Section>
        </div>
      )}

      {tab === 'relationships' && (
        <div className="space-y-10">
          <Section
            title="Relationship thresholds"
            description={effectiveModules.dating
              ? `Warmth needed for each stage, for any character living here. Blank uses the default (${DEFAULT_STAGE_HINT}).`
              : 'Connection milestones for any character living here. Blank uses the defaults (15, 35, 55, 75, 90).'}
            surface="bare"
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {EDITABLE_STAGES.map((stage) => (
                <NumberField
                  key={stage}
                  label={effectiveModules.dating ? formatRelationshipStage(stage) : ({ acquaintances: 'New connection', warming_up: 'Familiar', getting_close: 'Trusted', close: 'Close', sweethearts: 'Deep bond' } as Record<string, string>)[stage]}
                  min={0}
                  max={100}
                  placeholder={String(DEFAULT_THRESHOLDS[stage])}
                  value={thresholds[stage] ?? ''}
                  onChange={(e) => setThreshold(stage, e.target.value)}
                />
              ))}
            </div>
          </Section>

          {effectiveModules.dating && <div className="space-y-8">
            <div>
              <h3 className="text-base font-medium text-text">Dating tools</h3>
              <p className="text-xs text-text-muted">Gift, intimacy, item, and scene options are preserved if you switch dating off.</p>
            </div>
          <Section
            title="Content rating"
            description="How explicit intimate scenes get written for characters living here, and which intimate actions the Relationship panel offers. Overrides the global Settings value. So a wholesome world and an explicit one can sit side by side without touching Settings between chats."
            surface="bare"
          >
            <SelectField
              label="Rating"
              value={intimacyLevel ?? 'inherit'}
              onChange={(e) => setIntimacyLevel(e.target.value === 'inherit' ? undefined : (e.target.value as IntimacyDetailLevel))}
            >
              <option value="inherit">Use the global setting</option>
              <option value="default">No instruction either way</option>
              <option value="fade_to_black">Fade to black</option>
              <option value="suggestive">Suggestive</option>
              <option value="explicit">Explicit</option>
            </SelectField>
            <p className="mt-2 text-xs text-text-muted">
              {intimacyLevel === undefined
                ? 'Follows whatever Settings → Generation is set to, changing with it.'
                : intimacyLevel === 'default'
                  ? 'Pinned: this world sends no instruction either way, even if the global setting changes. Every intimate action stays available in the Relationship panel.'
                  : intimacyLevel === 'explicit'
                    ? 'Positions, toys, and other explicit beats become available in the Relationship panel once warmth earns them.'
                    : 'The model is asked to keep intimate scenes at this register, and only kissing spots are offered in the Relationship panel.'}
            </p>
          </Section>

          <Section
            title="Gift catalog"
            description="Overrides the default gift shop for characters living here. Leave empty to use the built-in catalog."
            surface="bare"
          >
            <ListEditor
              items={gifts}
              getKey={(g) => g.id}
              onAdd={addGift}
              onRemove={(g) => removeGift(g.id)}
              addLabel="Add gift"
              emptyHint="No custom gifts. The built-in catalog is used."
              renderItem={(gift) => (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_140px_100px]">
                  <TextField label="Name" value={gift.name} onChange={(e) => updateGift(gift.id, { name: e.target.value })} />
                  <SelectField
                    label="Rarity"
                    value={gift.rarity}
                    onChange={(e) => updateGift(gift.id, { rarity: e.target.value as GiftRarity })}
                  >
                    {GIFT_RARITIES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </SelectField>
                  <NumberField
                    label="Price"
                    value={gift.price}
                    onChange={(e) => updateGift(gift.id, { price: Math.max(0, Number(e.target.value) || 0) })}
                  />
                </div>
              )}
            />
          </Section>

          <Section
            title="Intimacy catalog"
            description="Kissing spots, positions, toys, and other intimate beats a relationship living here can unlock, beyond the ~37 built-in defaults. Positions/toys/activities only ever surface in the prompt once the user's own Intimacy detail setting is 'Explicit'. Give a toy a price and it has to actually be bought (from the Relationship panel) before it's usable or ever mentioned to the model. Leave it at 0 for no purchase step, same as every non-toy category."
            surface="bare"
          >
            <label
              className="mb-3 flex items-center gap-1.5 text-[11px] text-text-muted"
              title="For a non-humanoid or otherwise very different character/setting the built-in catalog (hands, hips, knees, a back to lie on) doesn't fit. This makes your own additions below the entire catalog instead of a supplement to the defaults."
            >
              <input
                type="checkbox"
                checked={replaceIntimacyCatalog}
                onChange={(e) => setReplaceIntimacyCatalog(e.target.checked)}
                disabled={intimacyOptions.length === 0}
                className="accent-accent"
              />
              Replace the built-in catalog entirely with my own additions below (for a non-humanoid or very different setting)
            </label>
            <ListEditor
              items={intimacyOptions}
              getKey={(o) => o.id}
              onAdd={addIntimacyOption}
              onRemove={(o) => removeIntimacyOption(o.id)}
              addLabel="Add unlockable"
              emptyHint="No custom additions. The built-in catalog of ~37 is used."
              renderItem={(option) => (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                  <TextField label="Label" value={option.label} onChange={(e) => updateIntimacyOption(option.id, { label: e.target.value })} />
                  <SelectField
                    label="Category"
                    value={option.category}
                    onChange={(e) => updateIntimacyOption(option.id, { category: e.target.value as IntimacyCategory })}
                  >
                    <option value="affection">Closeness</option>
                    <option value="kissing_spot">Kissing spot</option>
                    <option value="position">Position</option>
                    <option value="toy">Toy</option>
                    <option value="activity">Activity</option>
                  </SelectField>
                  <NumberField
                    label="Price"
                    min={0}
                    value={option.price ?? 0}
                    onChange={(e) => updateIntimacyOption(option.id, { price: Math.max(0, Number(e.target.value) || 0) || undefined })}
                  />
                  <NumberField
                    label="Min warmth"
                    min={0}
                    max={100}
                    value={option.minWarmth}
                    onChange={(e) => updateIntimacyOption(option.id, { minWarmth: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })}
                  />
                  <SelectField
                    label="Min commitment"
                    value={option.minCommitment ?? 'none'}
                    onChange={(e) =>
                      updateIntimacyOption(option.id, {
                        minCommitment: e.target.value === 'none' ? undefined : (e.target.value as IntimacyUnlockable['minCommitment']),
                      })
                    }
                  >
                    {COMMITMENT_ORDER.map((c) => (
                      <option key={c} value={c}>
                        {c === 'none' ? 'No floor' : formatCommitmentStatus(c)}
                      </option>
                    ))}
                  </SelectField>
                  {/* Second row: the fields the engine actually enforces on. Without `regions` and
                      `kinks` a custom entry silently bypasses a character's own off-limit regions
                      (`dating/touch.ts`) and hard limits (`dating/kinks.ts`), because it declares
                      nothing for either to match against. */}
                  <NumberField
                    label="Intensity"
                    min={0}
                    max={20}
                    placeholder={String(intimacyArousalWeight({ ...option, arousalWeight: undefined }))}
                    hint="How much this drives a scene per turn. Blank uses the per-category default."
                    value={option.arousalWeight ?? ''}
                    onChange={(e) =>
                      updateIntimacyOption(option.id, {
                        arousalWeight: e.target.value === '' ? undefined : Math.max(0, Math.min(20, Number(e.target.value) || 0)),
                      })
                    }
                  />
                  <TokenListField
                    label="Body regions"
                    hint={`Regions this involves. An entry that names none is never filtered by a character's limits. One of: ${BODY_REGIONS.join(', ')}.`}
                    value={option.regions}
                    allowed={BODY_REGIONS}
                    onCommit={(regions) => updateIntimacyOption(option.id, { regions: regions as IntimacyUnlockable['regions'] })}
                  />
                  <TokenListField
                    label="Kinks"
                    hint={`Kinks this involves; one hard limit here and the entry is never offered. Built-ins: ${BUILT_IN_KINKS.join(', ')}. Your own names work too.`}
                    value={option.kinks}
                    onCommit={(kinks) => updateIntimacyOption(option.id, { kinks })}
                  />
                  <TextAreaField
                    label="Player action line"
                    rows={2}
                    className="sm:col-span-3"
                    hint="What lands in the composer when this is clicked. {char} becomes the name. Blank uses a generic line."
                    value={option.actionText ?? ''}
                    onChange={(e) => updateIntimacyOption(option.id, { actionText: e.target.value || undefined })}
                  />
                  <TextAreaField
                    label="Model-facing note"
                    rows={2}
                    className="sm:col-span-2"
                    hint="How the act is described to the model. {char} becomes the name; the player is always 'you'."
                    value={option.promptNote ?? ''}
                    onChange={(e) => updateIntimacyOption(option.id, { promptNote: e.target.value || undefined })}
                  />
                </div>
              )}
            />
          </Section>

          <Section
            title="Item catalog"
            description="Consumables used from the Bag for an immediate authored effect. Separate from gifts, which are given to a character in a scene."
            surface="bare"
          >
            <ListEditor
              items={items}
              getKey={(i) => i.id}
              onAdd={addItem}
              onRemove={(i) => removeItem(i.id)}
              addLabel="Add item"
              emptyHint="No items yet."
              renderItem={(item) => (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_140px_100px]">
                    <TextField label="Name" value={item.name} onChange={(e) => updateItem(item.id, { name: e.target.value })} />
                    <SelectField
                      label="Rarity"
                      value={item.rarity}
                      onChange={(e) => updateItem(item.id, { rarity: e.target.value as GiftRarity })}
                    >
                      {GIFT_RARITIES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </SelectField>
                    <NumberField
                      label="Price"
                      value={item.price}
                      onChange={(e) => updateItem(item.id, { price: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <SelectField
                      label="Effect"
                      value={item.effect.kind}
                      onChange={(e) => setItemEffectKind(item.id, e.target.value as ItemEffect['kind'])}
                    >
                      <option value="relationship">Relationship boost</option>
                      <option value="flag">Set scene flag</option>
                      <option value="currency">Grant coins</option>
                    </SelectField>
                    {item.effect.kind === 'relationship' && (
                      <>
                        <SelectField
                          label="Dimension"
                          value={item.effect.dimension}
                          onChange={(e) =>
                            setItemEffectField(item.id, {
                              dimension: e.target.value as (typeof RELATIONSHIP_DELTA_DIMENSIONS)[number],
                            })
                          }
                        >
                          {RELATIONSHIP_DELTA_DIMENSIONS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </SelectField>
                        <NumberField
                          label="Amount"
                          value={item.effect.amount}
                          onChange={(e) =>
                            setItemEffectField(item.id, {
                              amount: Math.max(-10, Math.min(10, Math.round(Number(e.target.value) || 0))),
                            })
                          }
                        />
                      </>
                    )}
                    {item.effect.kind === 'flag' && (
                      <SelectField
                        label="Flag"
                        value={item.effect.flag}
                        onChange={(e) => setItemEffectField(item.id, { flag: e.target.value })}
                      >
                        {combinedSceneFlags(customSceneFlags).map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.label}
                          </option>
                        ))}
                      </SelectField>
                    )}
                    {item.effect.kind === 'currency' && (
                      <NumberField
                        label="Coins"
                        value={item.effect.amount}
                        onChange={(e) => setItemEffectField(item.id, { amount: Math.max(0, Number(e.target.value) || 0) })}
                      />
                    )}
                  </div>
                </div>
              )}
            />
          </Section>

          </div>}
        </div>
      )}

      {tab === 'simulation' && (
        <div className="space-y-8">
          <Section
            title="Custom scene flags"
            description="Branching-memory beats beyond the built-in four (first date, confession, jealousy, promise). Each needs a description. That's the AI classifier's bar for firing it."
            surface="bare"
          >
            <ListEditor
              items={customSceneFlags}
              getKey={(f) => f.id}
              onAdd={addCustomSceneFlag}
              onRemove={(f) => removeCustomSceneFlag(f.id)}
              addLabel="Add flag"
              emptyHint="Only the built-in four flags exist for this world."
              renderItem={(flag) => (
                <div className="space-y-1">
                  <TextField
                    label="Label"
                    value={flag.label}
                    onChange={(e) => updateCustomSceneFlag(flag.id, { label: e.target.value })}
                    placeholder="e.g. Moved in together"
                  />
                  <TextAreaField
                    label="When it fires"
                    rows={2}
                    value={flag.description}
                    onChange={(e) => updateCustomSceneFlag(flag.id, { description: e.target.value })}
                    placeholder="e.g. They explicitly agreed to share a home, not just spending a lot of time at each other's place"
                  />
                </div>
              )}
            />
          </Section>

          <Section
            title="Rules"
            description="When every condition holds, the actions run once. The app already produces all of these signals. This is what lets you hang an authored beat off one without writing code."
            surface="bare"
          >
            {triggers.length === 0 && (
              <p className="mb-3 text-xs text-text-muted">
                No rules yet. For example: when <em>trust ≥ 70</em> and the <em>confession</em> flag is set → remember
                "She has told him about her father". Which then rides into every later prompt.
              </p>
            )}
            <div className="space-y-3">
              {triggers.map((t) => (
                <div key={t.id} className="rounded-xl bg-bg-sunken p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <input
                      value={t.label}
                      onChange={(e) => updateTrigger(t.id, { label: e.target.value })}
                      aria-label="Rule name"
                      className="flex-1 rounded-lg bg-bg px-2.5 py-1.5 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
                    />
                    <label className="flex items-center gap-1.5 text-[11px] text-text-muted" title="Off by default: a repeatable rule that sets a flag or writes a memory would otherwise do it on every single turn.">
                      <input
                        type="checkbox"
                        checked={!!t.repeatable}
                        onChange={(e) => updateTrigger(t.id, { repeatable: e.target.checked })}
                        className="accent-accent"
                      />
                      Repeatable
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-text-muted">
                      <input
                        type="checkbox"
                        checked={t.enabled !== false}
                        onChange={(e) => updateTrigger(t.id, { enabled: e.target.checked })}
                        className="accent-accent"
                      />
                      On
                    </label>
                    <button
                      type="button"
                      onClick={() => setTriggers((list) => list.filter((x) => x.id !== t.id))}
                      aria-label={`Delete rule ${t.label}`}
                      className="text-text-muted transition-colors hover:text-danger"
                    >
                      <X size={13} strokeWidth={2.5} />
                    </button>
                  </div>

                  <TriggerConditionRows
                    conditions={t.when}
                    knownFlags={combinedSceneFlags(customSceneFlags)}
                    knownTriggers={triggers.filter((other) => other.id !== t.id).map((other) => ({ id: other.id, label: other.label }))}
                    onChange={(when) => updateTrigger(t.id, { when })}
                  />
                  <TriggerActionRows
                    actions={t.then}
                    knownFlags={combinedSceneFlags(customSceneFlags)}
                    onChange={(then) => updateTrigger(t.id, { then })}
                  />

                  <p className="mt-2 text-[11px] text-text-muted">
                    When {t.when.map(describeCondition).join(' and ') || '(nothing)'} → {t.then.map(describeAction).join(', ') || '(nothing)'}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                value={newTriggerLabel}
                onChange={(e) => setNewTriggerLabel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTrigger()}
                placeholder="New rule (e.g. She opens up about her father)"
                className="flex-1 rounded-xl bg-bg-sunken px-3 py-2 text-sm text-text outline-none ring-1 ring-transparent transition-shadow focus:ring-accent/40"
              />
              <Button onClick={addTrigger} disabled={!newTriggerLabel.trim()} className="flex items-center gap-1.5">
                <Plus size={14} strokeWidth={2} />
                Add
              </Button>
            </div>
          </Section>
          <Section
            title="Calendar"
            description="The year this world counts, its months, the names of its weekdays, and its holidays. Characters and the Game Master are told the date. Birthdays are a day of this world's year."
          >
            <CalendarEditor value={calendar} onChange={setCalendar} />
          </Section>
          {world && <Section
          title="World clock"
          description="Shared by every chat in this world. Advancing it moves every character's mood and weather forward. A manual authoring step that doesn't spend an action."
        >
          {(() => {
            const info = getCalendarInfo(currentDay, calendar)
            const weather = getWeather(world.id, currentDay, calendar)
            const months = calendarMonths(calendar)
            const draft = dateDraft ?? { year: info.year ?? Math.floor(currentDay / yearLength(calendar)), monthIndex: info.monthIndex, dayOfMonth: info.dayOfMonth }
            return (
              <>
                <div className="mb-1 text-sm text-text">
                  {info.custom ? formatCalendarDate(info) : <>Day {info.day} · {formatCalendarDate(info)}</>}
                  {info.holiday ? <span className="text-romance"> · {info.holiday}</span> : null}
                </div>
                <div className="mb-4 text-xs text-text-muted">
                  {PHASES[currentPhaseIndex]}, {describeWeather(weather)} ·{' '}
                  {getEnergyRemaining(currentDay, currentPhaseIndex)}/{getMaxEnergyForDay(currentDay)} actions left today
                </div>
                <Button variant="secondary" onClick={advanceClock} disabled={advancing}>
                  {advancing
                    ? 'Advancing…'
                    : `Advance to ${PHASES[(currentPhaseIndex + 1) % PHASES.length]}${
                        currentPhaseIndex === PHASES.length - 1 ? ' (next day)' : ''
                      }`}
                </Button>
                <label className="mt-4 flex items-start gap-2 text-sm text-text">
                  <input type="checkbox" className="mt-1" checked={advanceClockInPlay} onChange={(e) => setAdvanceClockInPlay(e.target.checked)} />
                  <span>
                    Advance time while role playing
                    <span className="block text-xs text-text-muted">The clock moves on when the story says time passes ("that evening", "the next morning", "two days later"), when a scene ends, and when the Game Master rules that time passes. Words in "quotes" don't count. Save to apply.</span>
                  </span>
                </label>
                <div className="mt-4 border-t border-border pt-4">
                  <div className="mb-2 text-xs font-medium text-text-muted">Set today's date</div>
                  <div className="flex flex-wrap items-end gap-2">
                    {info.custom && (
                      <NumberField label="Year" className="w-28" step={1} value={draft.year}
                        onChange={(e) => setDateDraft({ ...draft, year: Math.round(Number(e.target.value) || 0) })} />
                    )}
                    <SelectField label={info.custom ? 'Month' : 'Season'} className="w-40" value={draft.monthIndex}
                      onChange={(e) => {
                        const monthIndex = Number(e.target.value)
                        setDateDraft({ ...draft, monthIndex, dayOfMonth: Math.min(draft.dayOfMonth, months[monthIndex]?.days ?? 1) })
                      }}>
                      {months.map((m, i) => <option key={i} value={i}>{m.name || `Month ${i + 1}`}</option>)}
                    </SelectField>
                    <NumberField label="Day" className="w-24" min={1} max={months[draft.monthIndex]?.days ?? 1} step={1} value={draft.dayOfMonth}
                      onChange={(e) => setDateDraft({ ...draft, dayOfMonth: Math.max(1, Math.min(months[draft.monthIndex]?.days ?? 1, Math.round(Number(e.target.value) || 1))) })} />
                    <Button className="mb-3" onClick={() => void setClockDate()} disabled={advancing || !dateDraft}>Set date</Button>
                  </div>
                  <p className="text-xs text-text-muted">Keeps the time of day. Setting a date also saves the calendar above.</p>
                </div>
              </>
            )
          })()}
        </Section>}
        </div>
      )}
    </EditorShell>
  )
}
