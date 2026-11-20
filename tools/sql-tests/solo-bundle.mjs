// Compile les moteurs locaux et bots du mode solo (TS) en un module Node, via rolldown (fourni par Vite).
import { build } from 'rolldown'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../..')
const src = (p) => JSON.stringify(path.join(root, 'src', p).replace(/\\/g, '/'))

export async function loadSolo() {
  const out = path.join(here, 'out')
  fs.mkdirSync(out, { recursive: true })
  const entry = path.join(out, 'solo-entry.ts')
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
    ].join('\n'),
  )
  const file = path.join(out, 'solo-bundle.mjs')
  await build({
    input: entry,
    platform: 'node',
    resolve: { alias: { '@': path.join(root, 'src') } },
    output: { file, format: 'esm' },
    logLevel: 'warn',
  })
  return import(pathToFileURL(file).href + '?t=' + Date.now())
}
