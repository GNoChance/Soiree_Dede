// Génère public/dicts/fr-words.txt(.gz) et la table SYLLABLES de dictionary.ts.
// Usage : node tools/dict/build.mjs <lexique-grammalecte-fr-vX.txt>
// Node natif uniquement. Source : Grammalecte/Dicollecte (MPL 2.0), voir THIRD_PARTY_NOTICES.md
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const src = process.argv[2]
if (!src) { console.error('usage: node tools/dict/build.mjs <lexique.txt>'); process.exit(1) }

const MIN_COUNT = 40
// Seuils de niveaux (nb de mots contenant la syllabe) : level 1 si count >= T[0], ... level 5 sinon.
const T = (process.env.LEVELS ?? '8000,2500,800,250').split(',').map(Number)

const normalize = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').toLowerCase().replace(/[^a-z-]/g, '')
const BAD_TAGS = new Set(['npr', 'prn', 'patr', 'nb', 'nbro', 'pfx'])

const words = new Set()
for (const line of readFileSync(src, 'utf8').split('\n')) {
  const c = line.split('\t')
  if (c.length < 5 || !/^\d+$/.test(c[0])) continue
  const f = c[2]
  if (!f || f !== f.toLowerCase()) continue // majuscule => nom propre / sigle
  if (!/^[a-zàâäçéèêëîïôöùûüÿœæ]+(-[a-zàâäçéèêëîïôöùûüÿœæ]+)*$/.test(f)) continue // chiffres, apostrophes, espaces...
  if (c[4].split(' ').some((t) => BAD_TAGS.has(t))) continue
  const w = normalize(f)
  if (w.length >= 2 && /^[a-z]+(-[a-z]+)*$/.test(w)) words.add(w)
}
const sorted = [...words].sort()
const text = sorted.join('\n') + '\n'
mkdirSync(path.join(root, 'public/dicts'), { recursive: true })
writeFileSync(path.join(root, 'public/dicts/fr-words.txt'), text)
const gz = gzipSync(Buffer.from(text), { level: 9 })
writeFileSync(path.join(root, 'public/dicts/fr-words.txt.gz'), gz)
console.log(`mots: ${sorted.length}, txt: ${text.length} o, gz: ${gz.length} o`)

// Syllabes : séquences a-z de 2 et 3 lettres, comptées par mot (une fois par mot).
const cnt = new Map()
for (const w of sorted) {
  const seen = new Set()
  for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= w.length; i++) {
    const s = w.slice(i, i + n)
    if (/^[a-z]+$/.test(s)) seen.add(s)
  }
  for (const s of seen) cnt.set(s, (cnt.get(s) ?? 0) + 1)
}
const level = (c) => (c >= T[0] ? 1 : c >= T[1] ? 2 : c >= T[2] ? 3 : c >= T[3] ? 4 : 5)
const syl = [...cnt].filter(([, c]) => c >= MIN_COUNT).map(([s, c]) => ({ s, level: level(c), count: c }))
  .sort((a, b) => a.level - b.level || b.count - a.count || (a.s < b.s ? -1 : 1))
const dist = [0, 0, 0, 0, 0, 0]
for (const x of syl) dist[x.level]++
console.log(`syllabes: ${syl.length}, niveaux 1..5: ${dist.slice(1).join(' / ')}`)

const body = syl.map((x) => `${x.s}${x.level}${x.count}`).join(' ')
const tsPath = path.join(root, 'src/games/bombe-a-mots/dictionary.ts')
let ts = readFileSync(tsPath, 'utf8')
const re = /\/\/ BEGIN-SYLLABLES[\s\S]*?\/\/ END-SYLLABLES/
const block = `// BEGIN-SYLLABLES (généré par tools/dict/build.mjs, ne pas éditer)
// Format compact : <lettres><niveau 1-5><count>, ex. « tra1812 » = syllabe tra, niveau 1, 812 mots (lettres a-z, donc non ambigu).
const RAW_SYLLABLES = '${body}'
export const SYLLABLES: Syllable[] = RAW_SYLLABLES.split(' ').map((t) => {
  const m = /^([a-z]+)([1-5])([0-9]+)$/.exec(t)!
  return { s: m[1], level: Number(m[2]) as Syllable['level'], count: Number(m[3]) }
})
// END-SYLLABLES`
if (re.test(ts)) ts = ts.replace(re, () => block)
else ts = ts.replace('export const SYLLABLES: Syllable[] = []', () => block)
writeFileSync(tsPath, ts)
