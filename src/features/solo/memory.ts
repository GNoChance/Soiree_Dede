/**
 * Mémoire du bot (étape 2b) : ce qu'il retient des habitudes du joueur, sur le téléphone
 * uniquement (localStorage `solo:mem:<jeu>:<profil>`), une par jeu et par profil, commune
 * aux 9 persos. Jamais envoyée. Stockage bloqué / illisible : on repart de zéro sans
 * message (la mémoire vit alors le temps de la session).
 *
 * Mise à jour une fois par partie terminée (`learn`) : remise à zéro après 90 jours,
 * oubli progressif × 0,9, observations de la partie (+1), purge des entrées < 0,1,
 * plafonds par table, arrondi à 2 décimales, 100 000 caractères au plus.
 */
import type { SoloAction } from './engine'
import type { SoloLog } from './log'

export interface MemBase {
  v: 1
  /** Parties « récentes » (somme des poids, tend vers 10). */
  n: number
  /** Date.now() de la dernière partie. */
  at: number
  /** Défaites d'affilée du joueur. */
  streak: number
  /** Dernier SoloLog.id appris. */
  lastId: string
  /** 2 derniers types d'explication montrés (anti-rabâchage). */
  lastWhy: string[]
  /** Habitudes déjà annoncées (« nouveau »). */
  seen: string[]
}

/** Une habitude repérée, dite par le perso. `use` : 🎯 il s'en sert ; sinon 👀 il le sait seulement. */
export interface Insight {
  id: string
  /** Phrase au tutoiement, majuscule initiale, point final : « Tu commences toujours par le centre. » */
  text: string
  use: boolean
  /** Netteté (0 à 1) : les plus nettes d'abord. */
  score: number
}

export interface GameLearner<M extends MemBase = MemBase, H = unknown> {
  empty(): M
  /** Ajoute les observations de la partie (+1 chacune) à une mémoire déjà « oubliée » × 0,9. Peut muter `mem`. */
  observe(mem: M, log: SoloLog): M
  /** Tables à clés libres (Record) et leur plafond d'entrées : purgées < 0,1 et plafonnées. */
  caps: Record<string, number>
  insights(mem: M): Insight[]
  /** Petit objet transmis au bot ; undefined si rien d'utile (le bot joue alors comme à l'étape 1). */
  hintsFor(mem: M, rate: number, board: unknown, log: SoloLog | null): H | undefined
  /** Contexte figé au début de la partie (SoloLog.ctx), pour les moments liés à l'apprentissage. */
  logCtx?(mem: M, rate: number): unknown
  /** Préparation du bot (Bataille navale) : actions à jouer avant « prêt ». */
  botSetup?(mem: M, rate: number, board: unknown, me: string): SoloAction[] | null
}

export const MEM_MAX_CHARS = 100_000
export const FORGET = 0.9
export const RESET_MS = 90 * 24 * 3600 * 1000
export const MAX_PROFILES = 4
const HEADER = new Set(['v', 'n', 'at', 'streak', 'lastId', 'lastWhy', 'seen'])

export const memBase = (): MemBase => ({ v: 1, n: 0, at: 0, streak: 0, lastId: '', lastWhy: [], seen: [] })

/** Dose d'apprentissage selon le niveau ; 0 aux niveaux 1-2 et après 3 défaites d'affilée. */
export function learnRate(level: number, streak: number): number {
  if (streak >= 3) return 0
  const L = Math.min(10, Math.max(1, Math.round(level)))
  return [0, 0, 0.3, 0.45, 0.6, 0.75, 0.9, 1, 1, 1][L - 1]
}

/** « toujours » (≥ 85 %), « souvent » (≥ 60 %), sinon null. */
export const howOften = (share: number): 'toujours' | 'souvent' | null => (share >= 0.85 ? 'toujours' : share >= 0.6 ? 'souvent' : null)

export const sum = (a: readonly number[]): number => a.reduce((s, v) => s + v, 0)
const r2 = (v: number) => Math.round(v * 100) / 100

type Json = unknown

function scale(v: Json, f: number): Json {
  if (typeof v === 'number') return v * f
  if (Array.isArray(v)) return v.map((x) => scale(x, f))
  if (v && typeof v === 'object') {
    const o: Record<string, Json> = {}
    for (const [k, x] of Object.entries(v)) o[k] = scale(x, f)
    return o
  }
  return v
}

const round = (v: Json): Json => {
  if (typeof v === 'number') return r2(v)
  if (Array.isArray(v)) return v.map(round)
  if (v && typeof v === 'object') {
    const o: Record<string, Json> = {}
    for (const [k, x] of Object.entries(v)) o[k] = round(x)
    return o
  }
  return v
}

const weightOf = (v: Json): number => (typeof v === 'number' ? v : Array.isArray(v) ? v.reduce<number>((s, x) => s + weightOf(x), 0) : 0)

/** Oubli progressif : toutes les tables × f (l'en-tête n'est pas touché). */
export function decayMem<M extends MemBase>(mem: M, f = FORGET): M {
  const out = { ...mem } as Record<string, Json>
  for (const k of Object.keys(out)) if (!HEADER.has(k)) out[k] = scale(out[k], f)
  return out as M
}

/** Purge (< 0,1) + plafonds des tables libres, puis arrondi à 2 décimales. */
export function pruneMem<M extends MemBase>(mem: M, caps: Record<string, number>): M {
  const out = { ...mem } as Record<string, Json>
  for (const [k, cap] of Object.entries(caps)) {
    const t = out[k]
    if (!t || typeof t !== 'object' || Array.isArray(t)) continue
    let entries = Object.entries(t as Record<string, Json>).filter(([, v]) => weightOf(v) >= 0.1)
    if (entries.length > cap) entries = entries.sort((p, q) => weightOf(q[1]) - weightOf(p[1])).slice(0, cap)
    out[k] = Object.fromEntries(entries)
  }
  for (const k of Object.keys(out)) if (!HEADER.has(k)) out[k] = round(out[k])
  out.n = r2(out.n as number)
  return out as M
}

/** Garde-fou de taille : retire la moitié la plus faible des tables jusqu'à passer sous la limite. */
export function shrinkMem<M extends MemBase>(mem: M, caps: Record<string, number>, max = MEM_MAX_CHARS): M {
  let out = mem
  for (let guard = 0; JSON.stringify(out).length > max && guard < 20; guard++) {
    const o = { ...out } as Record<string, Json>
    let changed = false
    for (const k of Object.keys(caps)) {
      const t = o[k]
      if (!t || typeof t !== 'object' || Array.isArray(t)) continue
      const e = Object.entries(t as Record<string, Json>).sort((p, q) => weightOf(q[1]) - weightOf(p[1]))
      if (!e.length) continue
      o[k] = Object.fromEntries(e.slice(0, Math.floor(e.length / 2)))
      changed = true
    }
    out = o as M
    if (!changed) break
  }
  return out
}

/** Fin de partie : apprend une fois (`log.id`), pure. */
export function learn<M extends MemBase>(learner: GameLearner<M>, mem: M, log: SoloLog, now = Date.now()): M {
  if (!log.outcome || log.id === mem.lastId) return mem
  let m: M = mem.at && now - mem.at > RESET_MS ? learner.empty() : (JSON.parse(JSON.stringify(mem)) as M)
  m = decayMem(m)
  m.n = m.n * FORGET + 1
  m = learner.observe(m, log)
  m.at = now
  m.lastId = log.id
  m.streak = log.outcome === 'loss' ? m.streak + 1 : 0
  m = pruneMem(m, learner.caps)
  return shrinkMem(m, learner.caps)
}

/** Note le type d'explication montré (anti-rabâchage : 2 derniers). */
export const noteWhy = <M extends MemBase>(mem: M, type: string): M => ({ ...mem, lastWhy: [...mem.lastWhy, type].slice(-2) })

/** Nouvelle habitude (absente de `seen`) : la plus nette ; la mémoire la marque comme vue. */
export function newInsight<M extends MemBase>(learner: GameLearner<M>, mem: M): { mem: M; insight: Insight | null } {
  const fresh = learner.insights(mem).find((i) => !mem.seen.includes(i.id)) ?? null
  if (!fresh) return { mem, insight: null }
  return { mem: { ...mem, seen: [...mem.seen, fresh.id].slice(-40) }, insight: fresh }
}

/* ------------------------------------------------------------------ stockage */

export const memKey = (game: string, pid: string) => `solo:mem:${game}:${pid}`
const PROFILES_KEY = 'solo:profiles'
/** Repli quand le stockage est bloqué : la mémoire vit le temps de la session. */
const session = new Map<string, string>()

const store = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/** Valide grossièrement une mémoire lue : mêmes champs et mêmes formes que `empty()`. */
function sane<M extends MemBase>(raw: unknown, empty: M): M | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || (raw as MemBase).v !== 1) return null
  const out = { ...empty } as Record<string, unknown>
  for (const [k, def] of Object.entries(empty)) {
    const v = (raw as Record<string, unknown>)[k]
    if (v === undefined) continue
    if (Array.isArray(def)) {
      if (!Array.isArray(v)) return null
      if (def.length && v.length !== def.length && typeof def[0] === 'number') return null
    } else if (typeof def !== typeof v || (def !== null && typeof def === 'object' && (v === null || Array.isArray(v)))) return null
    out[k] = v
  }
  return out as M
}

export function readMem<M extends MemBase>(learner: GameLearner<M>, game: string, pid: string): M {
  const k = memKey(game, pid)
  let txt: string | null
  try {
    txt = store()?.getItem(k) ?? null
  } catch {
    txt = null
  }
  if (txt === null) txt = session.get(k) ?? null
  if (!txt) return learner.empty()
  try {
    return sane(JSON.parse(txt), learner.empty()) ?? learner.empty()
  } catch {
    return learner.empty()
  }
}

function touchProfile(s: Storage, pid: string, now: number) {
  let idx: Record<string, number> = {}
  try {
    const raw = JSON.parse(s.getItem(PROFILES_KEY) ?? '{}') as unknown
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) idx = raw as Record<string, number>
  } catch {
    idx = {}
  }
  idx[pid] = now
  const ids = Object.keys(idx).sort((p, q) => (idx[q] ?? 0) - (idx[p] ?? 0))
  for (const old of ids.slice(MAX_PROFILES)) {
    delete idx[old]
    const doomed: string[] = []
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (key && key.startsWith('solo:') && key.endsWith(`:${old}`)) doomed.push(key)
    }
    for (const key of doomed) s.removeItem(key)
  }
  s.setItem(PROFILES_KEY, JSON.stringify(idx))
}

export function writeMem<M extends MemBase>(game: string, pid: string, mem: M, now = Date.now()): void {
  const k = memKey(game, pid)
  const txt = JSON.stringify(mem)
  session.set(k, txt)
  try {
    const s = store()
    if (!s) return
    s.setItem(k, txt)
    touchProfile(s, pid, now)
  } catch {
    /* stockage plein ou bloqué : la mémoire reste celle de la session */
  }
}

/** « Oublier 🧽 » : efface ce que le bot sait du joueur à ce jeu. */
export function forgetMem(game: string, pid: string): void {
  const k = memKey(game, pid)
  session.delete(k)
  try {
    store()?.removeItem(k)
  } catch {
    /* stockage bloqué */
  }
}
