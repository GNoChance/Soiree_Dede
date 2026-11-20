/**
 * Explication de fin de partie (étape 2a) : un « moment clé » par partie, montré sur un
 * petit plateau figé en 1 ou 2 étapes (① ce qui s'est passé, ② le bon coup).
 * Cases = un entier par jeu : Morpion 0..8 ; 4 à la suite colonne × 6 + ligne ;
 * Bataille navale y × 10 + x ; Échecs 0..63 (0 = a8).
 */
import type { PlayerInfo } from '@/games/types'
import type { SoloX } from '../engine'
import type { Side, SoloLog } from '../log'

export type MarkKind = 'played' | 'better' | 'threat' | 'line' | 'zone'

/** played = rouge + croix ; better = vert + anneau + flèche ; threat = jaune + pointillés. */
export interface Mark {
  kind: MarkKind
  cells: number[]
  /** Flèche de → vers (cases). */
  arrow?: [number, number]
}

/** ply = nombre d'entrées du journal à rejouer (replayTo). */
export interface Step {
  ply: number
  marks: Mark[]
}

export interface Moment {
  /** ex. 'blocage_oublie' */
  type: string
  /** 0 à 100 */
  weight: number
  /** 1 ou 2 étapes. Vide : rien à montrer (pas de « Montre-moi »). */
  steps: Step[]
  vars: Record<string, string | number>
  /** 2b : le coup décisif du bot était un coup appris. */
  learned?: string
}

export interface WhyText {
  /** Phrases du moment, remplies (la 1re va sur la carte, la 2e sur l'écran seulement). */
  lines: string[]
  /** Conseil « Pour la prochaine fois » (défaite / nul seulement). */
  tip?: string
}

export interface GameWhy {
  /** Moments clés, avec toujours au moins le repli du jeu. `loser` = qui a perdu (ou 'me' pour un nul). */
  findMoments(log: SoloLog, loser: Side, budgetMs?: number): Moment[]
  /** Phrases du moment. loser 'me' : explication + conseil ; 'bot' : compliment, sans conseil. */
  texts(m: Moment, loser: Side): WhyText
}

/** Remplit « {var} » ; les variables absentes restent telles quelles (« {e} » est rempli par la voix). */
export function fill(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined ? `{${k}}` : String(vars[k])))
}

/** « 1er coup », « 3e coup ». */
export const nth = (n: number, word = 'coup'): string => `${n}${n === 1 ? 'er' : 'e'} ${word}`

/** Props du petit plateau figé (src/games/<id>/Diagram.tsx). */
export interface DiagramProps {
  /** Position à l'étape (replayTo). */
  x: SoloX
  log: SoloLog
  marks: Mark[]
  me: PlayerInfo
  bot: PlayerInfo
  /** Couleurs des camps (a / b du plateau), comme sur le vrai plateau. */
  colors: { a: string; b: string }
  /** Étape « le bon coup » : le vert clignote (sauf mouvement réduit). */
  blink?: boolean
}
