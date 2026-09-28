export type StageDepth = 'foreground' | 'midground' | 'background'

export interface StagePlacement {
  id: string
  depth: StageDepth
  x: number
  width: number
  height: number
  bottom: number
  visibleOnPhone: boolean
}

const supportingPositions: Omit<StagePlacement, 'id' | 'visibleOnPhone'>[] = [
  { depth: 'midground', x: 68, width: 35, height: 83, bottom: 2 },
  { depth: 'background', x: 55, width: 29, height: 70, bottom: 13 },
  { depth: 'background', x: 25, width: 25, height: 61, bottom: 18 },
  { depth: 'background', x: 78, width: 25, height: 61, bottom: 18 },
  { depth: 'background', x: 45, width: 23, height: 57, bottom: 22 },
]

/** A camera shot: one foreground figure, a companion farther back, then the rest in the scene. */
export function stageLayout(castIds: string[], focusId?: string, phoneSpeakerId: string | null | undefined = focusId): StagePlacement[] {
  const foregroundId = focusId && castIds.includes(focusId) ? focusId : castIds[0]
  const mirror = castIds.indexOf(foregroundId) % 2 === 1
  let supportingIndex = 0
  return castIds.map((id) => {
    if (id === foregroundId) {
      return {
        id, depth: 'foreground', x: castIds.length === 1 ? 50 : mirror ? 57 : 43,
        width: castIds.length === 1 ? 68 : 48, height: 98, bottom: -3,
        visibleOnPhone: id === phoneSpeakerId,
      }
    }
    const position = supportingPositions[supportingIndex++ % supportingPositions.length]
    return { id, ...position, x: mirror ? 100 - position.x : position.x, visibleOnPhone: false }
  })
}
