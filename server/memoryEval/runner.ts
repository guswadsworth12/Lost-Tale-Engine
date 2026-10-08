import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openAiRoot } from '../../src/lib/api/openAiRoot'
import { normalizeVector } from '../../src/lib/memory/vector'
import { memorySimilarities, memoryTextHash } from '../memoryVectorPlan'
import { sceneChainIds } from '../memoryPlan'
import { evaluateCase, parseCase, summarize, type EvalOptions, type RecallCase, type RecallResult } from './bench'

export function parseOptions(args: string[]) {
  const options: EvalOptions & { casesPath: string; embeddingsUrl?: string; embeddingsModel?: string } = {
    casesPath: fileURLToPath(new URL('./fixtures', import.meta.url)), module: 'off',
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (!['--cases', '--budget', '--module', '--embedder', '--embeddings-url', '--embeddings-model'].includes(flag)) throw new Error(`Unknown option: ${flag}`)
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    if (flag === '--embedder') {
      if (value !== 'stub') throw new Error('Embedder must be stub.')
      options.embedder = value
    }
    if (flag === '--embeddings-url') options.embeddingsUrl = value
    if (flag === '--embeddings-model') options.embeddingsModel = value
    if (flag === '--cases') options.casesPath = value
    if (flag === '--budget') {
      options.budgetTokens = Number(value)
    }
    if (flag === '--module') {
      if (value !== 'off' && value !== 'on') throw new Error('Module must be off or on.')
      options.module = value
    }
  }
  if (!!options.embeddingsUrl !== !!options.embeddingsModel) throw new Error('Provide both embeddings URL and model.')
  if (options.embedder && options.embeddingsUrl) throw new Error('Choose stub or a real endpoint, not both.')
  return options
}

function loadCases(options: ReturnType<typeof parseOptions>): RecallCase[] {
  const files = fs.statSync(options.casesPath).isDirectory()
    ? fs.readdirSync(options.casesPath).filter((name) => name.endsWith('.json')).sort().map((name) => path.join(options.casesPath, name))
    : [options.casesPath]
  const cases = files.flatMap((file) => {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return (Array.isArray(raw) ? raw : [raw]).map(parseCase)
  })
  if (!cases.length) throw new Error('No recall cases found.')
  if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error('Duplicate case ids.')
  return cases
}

function report(results: RecallResult[], options: ReturnType<typeof parseOptions>, print: (line: string) => void): number {
  print(`Current ranking (module ${options.module ?? 'off'}${options.embedder ? ', synthetic stub embedder: wiring only' : options.embeddingsUrl ? ', real embeddings endpoint' : ''})`)
  for (const r of results) {
    print(`${r.hit ? 'HIT' : 'MISS'} ${r.id}${r.mustNeverRegress ? ' [must-never-regress]' : ''}: ${r.question}`)
    print(`  Expected picked: ${r.recalled.length}/${r.expected}; tokens: ${r.usedTokens}/${r.budgetTokens}`)
    for (const { memory, reasons } of r.picks) print(`  Pick ${memory.id}: ${JSON.stringify(reasons)}`)
    if (r.missing.length) print(`  Missing: ${r.missing.join(', ')}`)
    if (r.forbidden.length) print(`  FORBIDDEN: ${r.forbidden.join(', ')}`)
  }
  const totals = summarize(results)
  print(`Totals: ${totals.hits}/${totals.cases} case hits; recall at budget: ${totals.recalled}/${totals.expected} (${(totals.recall * 100).toFixed(1)}%); forbidden picks: ${totals.violations}; must-never-regress failures: ${totals.regressions}`)
  // Ranking misses are baseline measurements. Boundary violations and protected misses fail CI.
  return totals.violations || totals.regressions ? 1 : 0
}

export function run(args: string[], print: (line: string) => void = console.log): number {
  const options = parseOptions(args)
  if (options.embeddingsUrl) throw new Error('Use the asynchronous CLI for a real endpoint.')
  return report(loadCases(options).map((c) => evaluateCase(c, options)), options, print)
}

/** Opt-in owner-run bench only. The app server never calls a model. */
export async function runAsync(args: string[], print: (line: string) => void = console.log): Promise<number> {
  const options = parseOptions(args)
  if (!options.embeddingsUrl || options.module !== 'on') return report(loadCases(options).map((c) => evaluateCase(c, options)), options, print)
  const model = options.embeddingsModel!
  const embed = async (input: string[]) => {
    const res = await fetch(openAiRoot(options.embeddingsUrl!) + '/embeddings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model, input, encoding_format: 'float' }),
    })
    if (!res.ok) throw new Error(`Embeddings endpoint failed (${res.status}).`)
    const body = await res.json() as { data?: { index: number; embedding: number[] }[] }
    if (body.data?.length !== input.length) throw new Error('Incomplete embedding batch.')
    const ordered = [...body.data].sort((a, b) => a.index - b.index)
    return ordered.map((row, i) => {
      if (row.index !== i || !Array.isArray(row.embedding)) throw new Error('Invalid embedding response.')
      return normalizeVector(row.embedding)
    })
  }
  const results: RecallResult[] = []
  for (const c of loadCases(options)) {
    const vectors = new Map<string, { model: string; textHash: string; vector: Float32Array }>()
    for (let start = 0; start < c.memories.length; start += 32) {
      const batch = c.memories.slice(start, start + 32)
      const embedded = await embed(batch.map((m) => m.text))
      batch.forEach((m, i) => vectors.set(m.id, { model, textHash: memoryTextHash(model, m.text), vector: embedded[i] }))
    }
    const [query] = await embed([c.scene.recentMessages.slice(-6).join('\n')])
    const chain = new Set(sceneChainIds(c.scene.chatId, (id) => c.chats.find((v) => v.id === id), (id) => c.stories.find((v) => v.id === id)))
    const similarities = new Map(Object.entries(memorySimilarities(c.memories, chain, c.scene.speakerId, model, query, (id) => vectors.get(id))))
    results.push(evaluateCase(c, { ...options, similarities }))
  }
  return report(results, options, print)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = await runAsync(process.argv.slice(2)) }
  catch (error) { console.error(error instanceof Error ? error.message : 'Recall evaluation failed.'); process.exitCode = 1 }
}
