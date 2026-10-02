#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pagesDir = join(root, 'docs/wiki/pages')
const wikiBase = 'https://github.com/guswadsworth12/Lost-Tale-Engine/wiki/'
const imageBase = 'https://raw.githubusercontent.com/guswadsworth12/Lost-Tale-Engine/master/'
const remote = process.env.WIKI_REMOTE || 'https://github.com/guswadsworth12/Lost-Tale-Engine.wiki.git'

function git(args, options = {}) {
  const result = spawnSync('git', args, { encoding: 'utf8', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr.trim() || result.stdout.trim()}`)
  return result.stdout.trim()
}

function check() {
  const names = readdirSync(pagesDir).filter((name) => name.endsWith('.md')).sort()
  const pages = new Set(names.map((name) => name.slice(0, -3)))
  const problems = []
  for (const required of ['Home', '_Sidebar', '_Footer']) {
    if (!pages.has(required)) problems.push(`Missing ${required}.md`)
  }
  const sidebar = readFileSync(join(pagesDir, '_Sidebar.md'), 'utf8')
  for (const name of names) {
    const content = readFileSync(join(pagesDir, name), 'utf8')
    const slug = name.slice(0, -3)
    if (slug[0] !== '_' && !content.startsWith('# ')) problems.push(`${name}: first line must be a page title`)
    if (slug[0] !== '_' && !sidebar.includes(`${wikiBase}${slug})`)) problems.push(`${name}: absent from _Sidebar.md`)
    for (const match of content.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
      if (!match[1].trim()) problems.push(`${name}: image missing alt text`)
      if (match[2].startsWith(imageBase)) {
        const path = join(root, decodeURIComponent(match[2].slice(imageBase.length)))
        if (!existsSync(path)) problems.push(`${name}: missing repository image ${match[2]}`)
      }
    }
    for (const match of content.matchAll(/https:\/\/github\.com\/guswadsworth12\/Lost-Tale-Engine\/wiki\/([^\s)#]+)/g)) {
      const target = decodeURIComponent(match[1])
      if (!pages.has(target)) problems.push(`${name}: broken wiki link ${target}`)
    }
    for (const match of content.matchAll(/https:\/\/github\.com\/guswadsworth12\/Lost-Tale-Engine\/blob\/master\/([^\s)#]+)/g)) {
      const path = decodeURIComponent(match[1])
      if (!existsSync(join(root, path))) problems.push(`${name}: missing repository file ${path}`)
    }
  }
  if (problems.length) throw new Error(problems.join('\n'))
  console.log(`Checked ${names.length} wiki pages, sidebar links, and repository images.`)
  return names
}

function publish(dryRun) {
  const names = check()
  const temp = mkdtempSync(join(tmpdir(), 'lost-tales-wiki-'))
  const wiki = join(temp, 'wiki')
  const token = process.env.GITHUB_TOKEN
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  if (token) {
    const askpass = join(temp, 'askpass.sh')
    writeFileSync(askpass, '#!/bin/sh\ncase "$1" in *Username*) printf "x-access-token";; *) printf "%s" "$GITHUB_TOKEN";; esac\n')
    chmodSync(askpass, 0o700)
    env.GIT_ASKPASS = askpass
  }
  try {
    git(['clone', '--depth=1', remote, wiki], { env })
    for (const name of names) copyFileSync(join(pagesDir, name), join(wiki, name))
    git(['add', '--', ...names], { cwd: wiki, env })
    const changes = git(['diff', '--cached', '--name-only'], { cwd: wiki, env })
    if (!changes) return console.log('Wiki is already current.')
    if (dryRun) return console.log(`Would publish:\n${changes}`)
    git(['config', 'user.name', 'github-actions[bot]'], { cwd: wiki, env })
    git(['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], { cwd: wiki, env })
    git(['commit', '-m', 'Update wiki from repository documentation'], { cwd: wiki, env })
    git(['push', 'origin', 'HEAD'], { cwd: wiki, env })
    console.log(`Published:\n${changes}`)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

const command = process.argv[2]
if (command === 'check') check()
else if (command === 'publish') publish(process.argv.includes('--dry-run'))
else {
  console.error('Usage: node tools/wiki.mjs check | publish [--dry-run]')
  process.exitCode = 1
}
