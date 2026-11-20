// Compile les moteurs locaux, bots, explications (2a) et mémoires (2b) du mode solo (TS) en un module Node,
// via rolldown (fourni par Vite). `loadOldBots` : les bots de l'étape 1 (commit c629380), pour vérifier
// que sans `hints` les bots jouent exactement pareil.
import { build } from 'rolldown'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const src = (p) => JSON.stringify(path.join(root, 'src', p).replace(/\\/g, '/'))

export async function loadSolo() {
  const out = path.join(here, 'out')
  fs.mkdirSync(out, { recursive: true })
  const entry = path.join(out, `solo-entry-${process.pid}.ts`)
  fs.writeFileSync(
    entry,
    [
      `export { soloStart, soloAct } from ${src('features/solo/engine.ts')}`,
      `export { nextLevel, levelStars } from ${src('features/solo/level.ts')}`,
      `export * as morpion from ${src('games/morpion/local.ts')}`,
      `export * as q4 from ${src('games/quatre-a-la-suite/local.ts')}`,
      `export * as bn from ${src('games/bataille-navale/local.ts')}`,
      `export * as echecs from ${src('games/echecs/local.ts')}`,
      `export * as morpionBot from ${src('games/morpion/bot.ts')}`,
      `export * as q4Bot from ${src('games/quatre-a-la-suite/bot.ts')}`,
      `export * as bnBot from ${src('games/bataille-navale/bot.ts')}`,
      `export * as echecsBot from ${src('games/echecs/bot.ts')}`,
      `export * as level from ${src('features/solo/level.ts')}`,
      `export * as log from ${src('features/solo/log.ts')}`,
      `export * as memory from ${src('features/solo/memory.ts')}`,
      `export * as pick from ${src('features/solo/why/pick.ts')}`,
      `export * as voice from ${src('features/solo/why/voice.ts')}`,
      ...['morpion', 'quatre-a-la-suite', 'bataille-navale', 'echecs'].flatMap((g) => {
        const n = g === 'quatre-a-la-suite' ? 'q4' : g === 'bataille-navale' ? 'bn' : g
        return [`export { why as ${n}Why } from ${src(`games/${g}/why.ts`)}`, `export { learner as ${n}Learner } from ${src(`games/${g}/learn.ts`)}`]
      }),
    ].join('\n'),
  )
  const file = path.join(out, `solo-bundle-${process.pid}.mjs`)
  await build({
    input: entry,
    platform: 'node',
    resolve: { alias: { '@': path.join(root, 'src') } },
    output: { file, format: 'esm' },
    logLevel: 'warn',
  })
  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now())
  fs.rmSync(entry, { force: true })
  fs.rmSync(file, { force: true })
  return mod
}

/** Bots de l'étape 1 (git c629380), compilés à part : morpionBot, q4Bot, bnBot, echecsBot. */
export async function loadOldBots(rev = 'c629380') {
  const out = path.join(here, 'out', `old-${process.pid}`)
  fs.mkdirSync(out, { recursive: true })
  const lines = []
  for (const [g, n] of [['morpion', 'morpionBot'], ['quatre-a-la-suite', 'q4Bot'], ['bataille-navale', 'bnBot'], ['echecs', 'echecsBot']]) {
    const code = execFileSync('git', ['show', `${rev}:src/games/${g}/bot.ts`], { cwd: root, encoding: 'utf8' })
    const dir = path.join(root, 'src', 'games', g).replace(/\\/g, '/')
    const file = path.join(out, `${g}-bot.ts`)
    fs.writeFileSync(file, code.replace(/from '\.\//g, `from '${dir}/`))
    lines.push(`export * as ${n} from ${JSON.stringify(file.replace(/\\/g, '/'))}`)
  }
  const entry = path.join(out, 'old-entry.ts')
  fs.writeFileSync(entry, lines.join('\n'))
  const file = path.join(out, 'old-bundle.mjs')
  await build({ input: entry, platform: 'node', resolve: { alias: { '@': path.join(root, 'src') } }, output: { file, format: 'esm' }, logLevel: 'warn' })
  const mod = await import(pathToFileURL(file).href + '?t=' + Date.now())
  fs.rmSync(out, { recursive: true, force: true })
  return mod
}
