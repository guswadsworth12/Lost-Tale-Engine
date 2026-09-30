import { describe, expect, it } from 'vitest'
import {
  FOCUS_STEP,
  autoHome,
  applyLayout,
  captureLayout,
  figureLayer,
  figureWidthCaps,
  MIN_FIGURE_WIDTH,
  normalizeSceneStage,
  normalizeStageLayouts,
  phoneFocusId,
  pinAll,
  pinCue,
  resolveStage,
  sceneStageFromLegacy,
  type StageLayout,
} from './stageDirection'

const cast = ['ash', 'bea', 'cole']
const points = (stage: ReturnType<typeof resolveStage>) => Object.fromEntries(stage.figures.map((f) => [f.id, f.point]))

describe('automatic direction', () => {
  it('gives each cast member a home spot by roster order alone', () => {
    const homes = cast.map((_, i) => autoHome(i, cast.length))
    expect(homes[0].x).toBeLessThan(homes[1].x)
    expect(homes[1].x).toBeLessThan(homes[2].x)
    expect(autoHome(0, 1)).toEqual({ x: 0.5, depth: 0.7 })
    // A larger cast alternates rows so nobody stands in front of anybody.
    expect(autoHome(0, 5).depth).not.toBe(autoHome(1, 5).depth)
  })

  it('moves only the old and new speaker when the speaker changes, never anyone else', () => {
    const beaSpeaks = points(resolveStage(cast, 'bea', undefined, []))
    const coleSpeaks = points(resolveStage(cast, 'cole', undefined, []))
    expect(coleSpeaks.ash).toEqual(beaSpeaks.ash)
    expect(beaSpeaks.bea.depth - coleSpeaks.bea.depth).toBeCloseTo(FOCUS_STEP)
    expect(coleSpeaks.cole.depth - beaSpeaks.cole.depth).toBeCloseTo(FOCUS_STEP)
    // Stepping forward is in place: nobody changes sides.
    expect(coleSpeaks.cole.x).toBe(beaSpeaks.cole.x)
  })

  it('only lights the speaker with the light focus style', () => {
    const lit = resolveStage(cast, 'bea', { focus: 'light' }, [])
    expect(lit.figures.find((f) => f.id === 'bea')).toMatchObject({ focused: true })
    expect(points(lit)).toEqual(points(resolveStage(cast, 'cole', { focus: 'light' }, [])))
    expect(figureLayer(lit.figures[1])).toBeGreaterThan(figureLayer(lit.figures[0]))
  })
})

describe('saved layouts and pinned cues', () => {
  const layout: StageLayout = {
    id: 'l1', name: 'Tavern table', width: 90, depth: 50, focus: 'light', updatedAt: 1,
    cues: { ash: { x: 0.3, depth: 0.2 }, bea: { x: 0.5, depth: 0.8, scale: 1.2, enter: 'slide-left' }, cole: { x: 0.7, depth: 0.2, exit: 'fade' } },
  }

  it('reuses a three-character layout in any scene that picks it, whoever is speaking', () => {
    const sceneA = resolveStage(cast, 'ash', { layoutId: 'l1' }, [layout])
    const sceneB = resolveStage(['cole', 'bea', 'ash'], 'cole', { layoutId: 'l1' }, [layout])
    expect(sceneA).toMatchObject({ width: 90, depth: 50, focus: 'light', direction: 'layout' })
    for (const id of cast) expect(points(sceneB)[id]).toEqual(points(sceneA)[id])
    expect(sceneA.figures.find((f) => f.id === 'bea')).toMatchObject({ scale: 1.2, enter: 'slide-left', exit: 'rise', source: 'layout' })
    expect(sceneA.figures.find((f) => f.id === 'cole')?.exit).toBe('fade')
  })

  it('lets a scene pin one character over the layout, and places anyone the layout lacks automatically', () => {
    const scene = pinCue({ layoutId: 'l1' }, 'bea', { x: 0.9, depth: 0.5 })
    const stage = resolveStage([...cast, 'wren'], 'wren', scene, [layout])
    expect(stage.direction).toBe('pinned')
    expect(stage.figures.map((f) => [f.id, f.source])).toEqual([['ash', 'layout'], ['bea', 'pinned'], ['cole', 'layout'], ['wren', 'auto']])
    expect(points(stage).bea.x).toBeCloseTo(0.89)
    // Pinned and layout positions never move for focus.
    expect(points(resolveStage(cast, 'bea', scene, [layout])).bea).toEqual(points(resolveStage(cast, 'ash', scene, [layout])).bea)
  })

  it('returns to automatic direction when the layout is gone or cleared', () => {
    expect(resolveStage(cast, 'ash', { layoutId: 'deleted' }, [layout]).direction).toBe('automatic')
    expect(resolveStage(cast, 'ash', undefined, [layout]).direction).toBe('automatic')
  })

  it('pins everyone where they stand to start arranging, and captures the stage as a layout', () => {
    const stage = resolveStage(cast, 'bea', undefined, [])
    const pinned = pinAll(undefined, stage)
    // Pinned at home, not at the focus step, so nothing jumps.
    expect(pinned.cues?.bea).toEqual(stage.figures[1].home)
    const saved = captureLayout(resolveStage(cast, 'ash', { ...pinned, width: 70 }, []), ' Three at the bar ', 'l2', 5)
    expect(saved).toMatchObject({ id: 'l2', name: 'Three at the bar', width: 70, updatedAt: 5 })
    expect(Object.keys(saved.cues)).toEqual(cast)
    expect(applyLayout({ ...pinned, width: 70, focus: 'light' }, 'l2')).toEqual({ layoutId: 'l2' })
  })
})

describe('figure widths', () => {
  it('keep side-by-side characters from covering each other', () => {
    const stage = resolveStage(cast, 'bea', undefined, [])
    const caps = figureWidthCaps(stage.figures)
    const [a, b, c] = stage.figures
    // Two neighbours' half-widths never add up to more than the distance between them.
    expect((caps.ash + caps.bea) / 2).toBeLessThanOrEqual(Math.abs(b.point.x - a.point.x) * 100 + 1e-9)
    expect((caps.bea + caps.cole) / 2).toBeLessThanOrEqual(Math.abs(c.point.x - b.point.x) * 100 + 1e-9)
    expect(figureWidthCaps([a])).toEqual({ ash: 100 })
  })

  it('never shrink a character placed on top of another to nothing', () => {
    const caps = figureWidthCaps([{ id: 'ash', point: { x: 0.5, depth: 0.2 } }, { id: 'bea', point: { x: 0.5, depth: 0.8 } }])
    expect(caps).toEqual({ ash: MIN_FIGURE_WIDTH, bea: MIN_FIGURE_WIDTH })
  })
})

describe('phone focus', () => {
  it('always frames exactly one character: the speaker, else the last speaker, else the lead', () => {
    expect(phoneFocusId(cast, 'bea', 'ash')).toBe('bea')
    expect(phoneFocusId(cast, undefined, 'cole')).toBe('cole')
    expect(phoneFocusId(cast, 'someone-gone', undefined)).toBe('ash')
    expect(phoneFocusId([], undefined, undefined)).toBeUndefined()
  })
})

describe('saved direction from requests', () => {
  it('keeps known shapes and clamps them', () => {
    expect(normalizeSceneStage({ layoutId: 'l1', width: 500, focus: 'spin', cues: { a: { x: 9, depth: 0.5, scale: 3, enter: 'teleport', exit: 'fade' }, b: { x: 'no' } } }))
      .toEqual({ layoutId: 'l1', width: 100, cues: { a: { x: 0.89, depth: 0.5, scale: 1.4, exit: 'fade' } } })
    expect(normalizeSceneStage({})).toBeUndefined()
    expect(normalizeStageLayouts([{ id: 'l1', name: 'A', cues: {} }, { id: 'l1', name: 'Dupe' }, { name: 'No id' }, 'x']))
      .toEqual([{ id: 'l1', name: 'A', width: 80, depth: 45, focus: 'light', cues: {}, updatedAt: 0 }])
  })

  it('turns an arrangement saved in the browser into the scene\'s pinned direction', () => {
    expect(sceneStageFromLegacy({ width: 70, depth: 40, positions: { ash: { x: 0.4, depth: 0.3 } } })).toEqual({ width: 70, depth: 40, cues: { ash: { x: 0.4, depth: 0.3 } } })
    expect(sceneStageFromLegacy(undefined)).toBeUndefined()
    expect(normalizeSceneStage({ cues: { ash: { x: 0.17496570394114033, depth: 0.7057632398753895 } } })).toEqual({ cues: { ash: { x: 0.175, depth: 0.706 } } })
  })
})
