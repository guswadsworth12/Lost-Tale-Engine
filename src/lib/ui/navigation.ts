/** Presentation ids only; stored Chat, Persona, and World types keep their existing names. */
export const VIEW_IDS = ['stories', 'cast', 'worlds', 'lore', 'media', 'writer', 'settings'] as const
export type ViewId = (typeof VIEW_IDS)[number]

export const USER_LABELS = {
  Chat: 'Story',
  Characters: 'Cast',
  'World Info': 'Lore',
  Gallery: 'Media',
  Assistant: "Writer's Room",
} as const

export const LEGACY_VIEW_ALIASES = {
  chat: 'stories',
  characters: 'cast',
  personas: 'cast',
  worldinfo: 'lore',
  gallery: 'media',
  assistant: 'writer',
} as const satisfies Record<string, ViewId>

/** Old editor links continue to land on the closest new tab. */
export const WORLD_TAB_ALIASES = {
  campaign: 'story-rules',
  prompts: 'advanced',
  lore: 'canon',
  scenes: 'locations',
  dating: 'relationships',
  clock: 'simulation',
} as const

export const CHARACTER_TAB_ALIASES = {
  identity: 'character',
  prompts: 'behavior',
  life: 'background',
  vn: 'presentation',
  dating: 'relationships',
  worldsim: 'world-life',
} as const
