export interface StagePoint {
  /** Horizontal position within the stage, from 0 (left) to 1 (right). */
  x: number
  /** Distance toward the viewer, from 0 (back line) to 1 (front line). */
  depth: number
}

export interface StageAreaSettings {
  width: number
  depth: number
  positions: Record<string, StagePoint>
}

export const DEFAULT_STAGE_AREA: StageAreaSettings = { width: 80, depth: 45, positions: {} }

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Keep a character's feet inside the trapezoid as they move toward or away from the viewer. */
export function clampStagePoint(point: StagePoint): StagePoint {
  const depth = clamp(point.depth, 0, 1)
  const halfWidth = 0.28 + 0.22 * depth
  return { x: clamp(point.x, 0.5 - halfWidth, 0.5 + halfWidth), depth }
}

export function moveStagePoint(point: StagePoint, dx: number, dy: number, areaDepth: number): StagePoint {
  return clampStagePoint({ x: point.x + dx, depth: point.depth + dy / (areaDepth / 100) })
}

/** Convert a floor position into a sprite's size and screen position. */
export function stagePointStyle(point: StagePoint, areaDepth: number) {
  const position = clampStagePoint(point)
  return {
    x: position.x * 100,
    bottom: areaDepth * (1 - position.depth),
    width: 20 + 28 * position.depth,
    height: 32 + 60 * position.depth,
  }
}
