/**
 * Journal d'une partie solo (étape 2a) : tous les coups de la phase « playing », dans
 * l'ordre, enregistrés par useSoloMatch.commit. Gardé en mémoire vive uniquement (jamais
 * écrit sur le téléphone, jamais envoyé). Sert à l'explication de défaite, au compliment
 * et à l'apprentissage du bot (2b).
 */
import type { CharacterSlug } from '@/data/characters'
import { soloAct, type LocalDuelGame, type SoloAction, type SoloX } from './engine'

export type SoloOutcome = 'win' | 'loss' | 'draw'
export type Side = 'me' | 'bot'

export interface SoloLogEntry {
  by: Side
  /** { type: 'move', move } (phase playing uniquement). */
  action: SoloAction
  /** 2b : id de l'habitude utilisée par le bot pour ce coup. */
  learned?: string
}

export interface SoloLog {
  /** Unique par partie (évite d'apprendre deux fois la même). */
  id: string
  game: string
  me: string
  bot: string
  first: string
  perso: CharacterSlug
  level: number
  /** Secret du joueur au tout début (Bataille navale : sa flotte tirée au sort). */
  secret0: unknown
  /** Préparation (Bataille navale). */
  setup: Array<{ by: Side; action: SoloAction }>
  /** État au DÉBUT de la phase playing (flottes définitives comprises) ; null tant qu'on prépare. */
  x0: SoloX | null
  entries: SoloLogEntry[]
  outcome: SoloOutcome | null
  /** 2b : contexte d'apprentissage figé au début de la partie (ex. cases habituelles). */
  ctx?: unknown
}

export const newLogId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const actorOf = (log: SoloLog, by: Side) => (by === 'me' ? log.me : log.bot)

/** Position après les n premières entrées : rejoue soloAct depuis x0. */
export function replayTo<B, M>(local: LocalDuelGame<B, M>, log: SoloLog, n: number): SoloX {
  const g = local as unknown as LocalDuelGame
  if (!log.x0) throw new Error('no_x0')
  let x: SoloX = log.x0
  const end = Math.max(0, Math.min(n, log.entries.length))
  for (let i = 0; i < end; i++) x = soloAct(g, x, actorOf(log, log.entries[i].by), log.entries[i].action)
  return x
}

/** Toutes les positions : out[n] = position après n entrées (0..entries.length). */
export function replayAll<B, M>(local: LocalDuelGame<B, M>, log: SoloLog): SoloX[] {
  const g = local as unknown as LocalDuelGame
  if (!log.x0) return []
  const out: SoloX[] = [log.x0]
  let x: SoloX = log.x0
  for (const e of log.entries) {
    x = soloAct(g, x, actorOf(log, e.by), e.action)
    out.push(x)
  }
  return out
}

/** Coup joué (contenu de { type: 'move', move }). */
export const moveOf = <M = unknown>(e: SoloLogEntry): M => e.action.move as M

/** Id de l'habitude apprise d'un coup du bot d'indice dans [from, to[ (le coup décisif), sinon undefined. */
export function learnedNear(log: SoloLog, from: number, to: number): string | undefined {
  for (let i = Math.max(0, from); i < Math.min(to, log.entries.length); i++) {
    const e = log.entries[i]
    if (e.by === 'bot' && e.learned) return e.learned
  }
  return undefined
}
