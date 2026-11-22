// Contrôle des banques de quiz : node tools/quiz-check/check.mjs
// - Cerveau en fête : 3 distracteurs distincts, réponse ≠ distracteurs, longueurs ≤ 120,
//   aucun distracteur accepté par la tolérance de saisie (sinon la question doit être « QCM »),
//   doublons d'énoncés.
// - Le plus proche : réponse numérique finie, |x| ≤ 1e15, doublons d'énoncés.
// Sortie non nulle s'il y a une erreur.
import { createJiti } from 'jiti'
import { fileURLToPath } from 'node:url'

const jiti = createJiti(import.meta.url, { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } })
const { QUESTIONS } = await jiti.import('../../src/games/cerveau-en-fete/questions.ts')
const { CLOSE_QUESTIONS } = await jiti.import('../../src/games/le-plus-proche/questions.ts')

// Port fidèle de _cef_norm / _cef_lev / _cef_match (supabase/games/cerveau-en-fete.sql)
const FROM = 'àâäáãåçéèêëíìîïñóòôöõúùûüýÿÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÓÒÔÖÕÚÙÛÜÝŸ'
const TO = 'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUYY'
function norm(p) {
  let s = (p ?? '').slice(0, 120).replaceAll('œ', 'oe').replaceAll('Œ', 'OE').replaceAll('æ', 'ae').replaceAll('Æ', 'AE')
  s = [...s].map((c) => { const i = FROM.indexOf(c); return i >= 0 ? TO[i] : c }).join('').toLowerCase()
  s = s.replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(les|le|la|l|une|un|des) /, '')
  return s.replaceAll(' ', '')
}
function lev(a, b) {
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length]
}
function match(guess, accept) {
  const g = norm(guess)
  if (!g) return false
  for (const a of accept) {
    if (g === a) return true
    if (/[0-9]/.test(a) || a.length <= 3) continue
    const tol = a.length <= 6 ? 1 : 2
    if (Math.abs(g.length - a.length) <= tol && lev(g, a) <= tol) return true
  }
  return false
}

let errors = 0
const err = (m) => { errors++; console.log('ERREUR ' + m) }
const key = (q) => `${q.prompt.toLowerCase().replace(/\s+/g, ' ').trim()}|${q.image?.url ?? ''}`

// --- Cerveau en fête
const seen = new Map()
for (const q of QUESTIONS) {
  const tag = `${q.id} [${q.theme}] « ${q.prompt} »`
  if (![1, 2, 3].includes(q.difficulty)) err(`${tag} : difficulté`)
  if (!q.prompt || q.prompt.length > 200) err(`${tag} : énoncé vide ou trop long`)
  if (!q.answer || q.answer.length > 120) err(`${tag} : réponse vide ou > 120`)
  if (q.distractors.length < 3) err(`${tag} : moins de 3 distracteurs`)
  const ds = q.distractors.slice(0, 3)
  if (new Set(ds.map(norm)).size !== ds.length) err(`${tag} : distracteurs en double`)
  if (ds.some((d) => !d || d.length > 120)) err(`${tag} : distracteur vide ou > 120`)
  if (ds.includes(q.answer)) err(`${tag} : la réponse est dans les distracteurs`)
  const accept = [...new Set([q.answer, ...(q.aliases ?? [])].map(norm))].filter(Boolean)
  if (q.typeable !== false) {
    const bad = ds.filter((d) => match(d, accept))
    if (bad.length) err(`${tag} : distracteur accepté en saisie (${bad.join(', ')}) → mettre 'QCM'`)
  }
  const k = key(q)
  if (seen.has(k)) err(`${tag} : doublon de ${seen.get(k)}`)
  else seen.set(k, q.id)
}

// --- Le plus proche
const seen2 = new Map()
for (const q of CLOSE_QUESTIONS) {
  const tag = `${q.id} [${q.theme}] « ${q.prompt} »`
  if (typeof q.answer !== 'number' || !Number.isFinite(q.answer) || Math.abs(q.answer) > 1e15) err(`${tag} : réponse invalide`)
  if (![1, 2, 3].includes(q.difficulty)) err(`${tag} : difficulté`)
  const k = key(q)
  if (seen2.has(k)) err(`${tag} : doublon de ${seen2.get(k)}`)
  else seen2.set(k, q.id)
}

const count = (arr) => Object.entries(arr.reduce((m, q) => ((m[q.theme] = (m[q.theme] ?? 0) + 1), m), {})).map(([t, n]) => `${t} ${n}`).join(' · ')
console.log(`Cerveau en fête : ${QUESTIONS.length} questions (${count(QUESTIONS)})`)
console.log(`Le plus proche : ${CLOSE_QUESTIONS.length} questions (${count(CLOSE_QUESTIONS)})`)
console.log(errors ? `${errors} erreur(s)` : 'Aucune erreur')
process.exit(errors ? 1 : 0)
