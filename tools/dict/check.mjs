// Vérifications rapides du dictionnaire généré. Usage : node tools/dict/check.mjs
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const words = new Set(gunzipSync(readFileSync('public/dicts/fr-words.txt.gz')).toString().split('\n').filter(Boolean))
console.log('mots', words.size)
for (const w of ['mangeaient', 'chevaux', 'belles', 'arc-en-ciel', 'oeuvre', 'coeur', 'macron', 'bordeaux', 'paris', 'france', 'sncf', 'l', 'xyz'])
  console.log(w, words.has(w))

const ts = readFileSync('src/games/bombe-a-mots/dictionary.ts', 'utf8')
const raw = /RAW_SYLLABLES = '([^']*)'/.exec(ts)[1].split(' ')
const m = new Map(raw.map((x) => { const r = /^([a-z]+)([1-5])(\d+)$/.exec(x); return [r[1], r[2] + '/' + r[3]] }))
for (const s of ['tra', 'xyl', 'ing', 'qu', 'zz', 'kyl']) console.log(s, 'niveau/count =', m.get(s) ?? 'absente')
