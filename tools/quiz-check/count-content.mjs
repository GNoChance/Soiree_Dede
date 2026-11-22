// Inventaire du contenu des jeux d'ambiance : node tools/quiz-check/count-content.mjs
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'

const jiti = createJiti(import.meta.url, { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } })
const g = (p) => jiti.import(`../../src/games/${p}`)
const by = (arr, k) =>
  Object.entries(arr.reduce((m, x) => ((m[x[k]] = (m[x[k]] ?? 0) + 1), m), {}))
    .map(([a, b]) => `${a} ${b}`)
    .join(' · ')

const dd = (await g('dessine-devine/words.ts')).WORDS
console.log('Dessine-devine', dd.length, '|', Object.keys(dd[0]).join(','), '|', by(dd, 'difficulty'))
console.log('Nom de code', (await g('nom-de-code/words.ts')).NDC_WORDS.length)
const uc = (await g('undercover/words.ts')).WORD_PAIRS
console.log('Undercover', uc.length, '|', Object.keys(uc[0]).join(','))
const qs = (await g('qui-suis-je/cards.ts')).WHO_CARDS
console.log('Qui suis-je', qs.length, '|', by(qs, 'theme'))
const tp = (await g('tu-preferes/dilemmas.ts')).DILEMMAS
console.log('Tu préfères', tp.length, '|', by(tp, 'theme'))
const av = (await g('action-ou-verite/cards.ts')).TD_CARDS
console.log('Action ou vérité', av.length, '|', Object.keys(av[0]).join(','), '|', by(av, 'kind'))
console.log('Gages', (await g('action-ou-verite/gages.ts')).GAGES.length)
console.log('Petit bac (catégories)', (await g('petit-bac/categories.ts')).CATEGORIES.length)
console.log('Qui de nous', (await g('qui-de-nous/questions.ts')).QUESTIONS.length)
