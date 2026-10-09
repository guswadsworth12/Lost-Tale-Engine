import type { MemoryReasons } from '../src/lib/memory/rank.ts'
const booleans = ['pinned', 'openThread', 'recent', 'important', 'strongFeeling', 'samePlace', 'oftenRecalled', 'similarMeaning']
const arrays = ['aboutPresent', 'matchedWords', 'linkedThrough']
/** Strict, bounded Inspector metadata; never accepts prompt text or arbitrary keys. */
export function validRecallReasons(value: unknown): value is MemoryReasons {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!['pinned', 'openThread', 'recent', 'important'].every((key) => typeof row[key] === 'boolean')
    || !['aboutPresent', 'matchedWords'].every((key) => Array.isArray(row[key])) || typeof row.score !== 'number' || !Number.isFinite(row.score)) return false
  return Object.entries(row).every(([key, v]) => {
    if (booleans.includes(key)) return typeof v === 'boolean'
    if (arrays.includes(key)) return Array.isArray(v) && v.length <= 10 && v.every((s) => typeof s === 'string' && s.length <= 80)
    if (key === 'score') return typeof v === 'number' && Number.isFinite(v)
    if (key === 'linkedWeights') return !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 10
      && Object.entries(v).every(([name, weight]) => name.length <= 80 && typeof weight === 'number' && Number.isFinite(weight))
    return false
  })
}
