import type { CharacterMemory, MemoryRecall } from '../types'
import type { MemoryLink, EntityKind } from './links'
import type { MemoryReasons } from './rank'
export interface ExplorerMemory extends CharacterMemory {
  status: 'active' | 'retired' | 'faded' | 'summarized'
  summaryRunId?: string
  recall: MemoryRecall
}
export interface ExplorerConnection extends MemoryLink {
  effectiveWeight: number
  startedScene: string
  endedScene?: string
}
export interface ExplorerSubject {
  key: string
  kind: EntityKind
  id: string
  displayLabel?: string
  memoryIds: string[]
  linkIds: string[]
}
export interface MemoryExplorer {
  characterId: string
  deepMemory: boolean
  memories: ExplorerMemory[]
  connections: ExplorerConnection[]
  subjects: ExplorerSubject[]
}
export interface ReplyRecalls {
  characterId: string
  recorded: boolean
  memories: { id: string; text: string; reasons?: MemoryReasons }[]
}
