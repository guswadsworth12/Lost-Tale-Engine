import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { evaluateCase, parseCase, summarize, type EvalOptions } from './bench'

export function parseOptions(args: string[]) {
  const options: EvalOptions & { casesPath: string } = {
    casesPath: fileURLToPath(new URL('./fixtures', import.meta.url)), module: 'off',
  }
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (!['--cases', '--budget', '--module'].includes(flag)) throw new Error(`Unknown option: ${flag}`)
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`)
    if (flag === '--cases') options.casesPath = value
    if (flag === '--budget') {
      const budget = Number(value)
      if (!Number.isFinite(budget) || budget < 0) throw new Error('Budget must be a non-negative number.')
      options.budgetTokens = budget
    }
    if (flag === '--module') {
      if (value === 'on') throw new Error('Deep Memory is not implemented yet; use --module off for the baseline.')
      if (value !== 'off') throw new Error('Module must be off or on.')
    }
  }
  return options
}

export function run(args: string[], print: (line: string) => void = console.log): number {
  const options = parseOptions(args)
  const files = fs.statSync(options.casesPath).isDirectory()
    ? fs.readdirSync(options.casesPath).filter((name) => name.endsWith('.json')).sort().map((name) => path.join(options.casesPath, name))
    : [options.casesPath]
  const cases = files.flatMap((file) => {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return (Array.isArray(raw) ? raw : [raw]).map(parseCase)
  })
  if (!cases.length) throw new Error('No recall cases found.')
  if (new Set(cases.map((c) => c.id)).size !== cases.length) throw new Error('Duplicate case ids.')
  const results = cases.map((c) => evaluateCase(c, options))
  print('Current ranking baseline (module off)')
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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = run(process.argv.slice(2)) }
  catch (error) { console.error(error instanceof Error ? error.message : 'Recall evaluation failed.'); process.exitCode = 1 }
}
