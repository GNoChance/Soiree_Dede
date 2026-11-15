/**
 * Contrat « Bataille navale » (id `bataille-navale`) — miroir de
 * supabase/games/bataille-navale.sql. Jeu en DUEL avec phase de PRÉPARATION
 * SIMULTANÉE (setup, 60 s) : le state public est un DuelState<BnBoard, BnMove>
 * (cf. src/features/duel/types.ts) ; seul `board` est propre au jeu.
 *
 * Grille 10 × 10 : colonnes A–J (x = 0..9), lignes 1–10 (y = 0..9).
 * INFORMATION CACHÉE : les flottes ne sont JAMAIS dans `board` avant la fin de
 * la manche (`reveal`) ; chaque duelliste reçoit la sienne dans son secret.
 */
import type { DuelState } from '@/features/duel/types'

export type BnShipId = 'porte-avions' | 'cuirasse' | 'croiseur' | 'sous-marin' | 'torpilleur'

/** Élément de la composition de la flotte. */
export interface BnShipDef {
  id: BnShipId
  name: string
  size: number
}

/** h = vers la droite, v = vers le bas, à partir de (x, y). */
export type BnDir = 'h' | 'v'

/** Bateau placé : (x, y) = première case (gauche / haut). */
export interface BnShip {
  id: BnShipId
  x: number
  y: number
  dir: BnDir
}

/** miss = à l'eau ; hit = touché ; sunk = case d'un bateau coulé. */
export type BnShotResult = 'miss' | 'hit' | 'sunk'

export interface BnShot {
  x: number
  y: number
  r: BnShotResult
}

/** Ce que tout le monde sait des eaux d'un joueur. */
export interface BnWaters {
  /** Tirs REÇUS (dans l'ordre). Les cases d'un bateau coulé passent en `sunk`. */
  shots: BnShot[]
  /** Ses bateaux coulés (positions révélées). */
  sunk: BnShip[]
  /** Ses bateaux encore à flot. */
  left: number
}

/** Tirs TIRÉS par un joueur dans la manche. */
export interface BnStats {
  shots: number
  hits: number
  /** Touchés consécutifs en cours. */
  streak: number
  /** Meilleure série de touchés consécutifs. */
  best: number
}

export interface BnLast {
  by: string
  x: number
  y: number
  r: BnShotResult
  /** Renseigné seulement quand le tir coule le bateau. */
  ship: BnShipId | null
}

export interface BnBoard {
  size: 10
  /** Duellistes (a = couleur 1, b = couleur 2). */
  a: string
  b: string
  duel_no: number
  game_no: number
  /** Composition de la flotte (ordre d'affichage). */
  ships: BnShipDef[]
  /** Clé = propriétaire des eaux (celui qui reçoit les tirs). */
  waters: Record<string, BnWaters>
  /** Clé = tireur. */
  stats: Record<string, BnStats>
  /** Tirs joués dans la manche. */
  count: number
  last: BnLast | null
  /** Fin de manche : les deux flottes révélées. */
  reveal: Record<string, BnShip[]> | null
}

/** Coups de la préparation (phase setup). */
export type BnSetupMove = { type: 'place'; ships: BnShip[] } | { type: 'shuffle' }

/** Tir (phase playing). */
export interface BnShotMove {
  x: number
  y: number
}

export type BnMove = BnShotMove | BnSetupMove

/** Secret d'un duelliste (`match_secrets.secret`), réécrit à chaque changement. */
export interface BnSecret {
  duel_no: number
  game_no: number
  me: string
  fleet: BnShip[]
  /** Tirs reçus (copie de `waters[me].shots`). */
  received: BnShot[]
}

export type BnState = DuelState<BnBoard, BnMove>
