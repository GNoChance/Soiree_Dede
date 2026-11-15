/**
 * Contrat du jeu « Bombe à mots » (state public de matches.state + actions).
 * Côté serveur : supabase/games/bombe-a-mots.sql.
 *
 * Règles :
 * - Tour par tour dans l'ordre de table (`players`, tiré au hasard). Le joueur `turn`
 *   doit taper un mot qui CONTIENT `syllable` (comparaison sans accents) avant l'explosion.
 * - MÈCHE GLOBALE : 5 à 12 s tirées par le serveur (heure d'explosion jamais publiée),
 *   elle continue de brûler quand la bombe passe ; nouvelle mèche après chaque explosion.
 *   Le receveur a toujours au moins `grace_ms` (1,5 s) devant lui.
 * - Explosion : -1 vie au joueur actif ; 0 vie = éliminé ; pause de 3 s (`resume_at`)
 *   puis la bombe repart du joueur vivant suivant avec une nouvelle syllabe.
 * - Alphabet bonus : 21 lettres (`bonus_alphabet`, sans k w x y z). Quand un joueur les a
 *   toutes utilisées dans ses mots validés : +1 vie (plafonnée à `max_lives`) et son
 *   alphabet repart de zéro (même s'il est déjà au max).
 * - Difficulté : niveau visé = start_level + floor(words_count / level_every), plafonné à 5.
 * - Fin : dernier survivant gagne ; classement = ordre d'élimination inverse ;
 *   points = mots validés (plafonnés à 25).
 */
import type { BaseGameState } from '../types'

export interface BamWord {
  /** Joueur */
  p: string
  /** Mot normalisé (a-z et tirets) */
  w: string
  /** Syllabe imposée */
  s: string
  /** turn_n du coup */
  n: number
}

export interface BamExplosion {
  p: string
  s: string
  n: number
  eliminated: boolean
}

export type BamEvent =
  | {
      kind: 'word'
      n: number
      p: string
      w: string
      s: string
      /** Receveur de la bombe */
      to: string
      alphabet_full: boolean
      bonus_life: boolean
      at: string
    }
  | {
      kind: 'explosion'
      n: number
      p: string
      s: string
      /** Vies restantes de la victime */
      lives: number
      eliminated: boolean
      at: string
    }

export interface BamState extends BaseGameState {
  game: 'bombe-a-mots'
  phase: 'playing' | 'finished' | 'aborted'
  /** Ordre de table (aléatoire). */
  players: string[]
  alive: string[]
  /** Éliminés, dans l'ordre d'élimination. */
  eliminated: string[]
  /** Joueur qui tient la bombe (null en fin de partie). */
  turn: string | null
  /** Compteur de tours (une syllabe = un tour). À renvoyer dans les actions. */
  turn_n: number
  turn_started_at: string
  syllable: string
  /** Niveau (1-5) de la syllabe courante. */
  level: number
  /** Niveau visé par la progression. */
  target_level: number
  start_level: number
  level_every: number
  max_lives: number
  lives: Record<string, number>
  /** Lettres de l'alphabet bonus déjà utilisées (triées). */
  letters: Record<string, string>
  bonus_alphabet: string
  word_counts: Record<string, number>
  words_count: number
  words: BamWord[]
  explosions: BamExplosion[]
  bonuses: { p: string; n: number; life: boolean }[]
  last_event: BamEvent | null
  /** Fin de la pause (lancement / après explosion) : aucun mot accepté avant. */
  resume_at: string | null
  /** Début de la mèche courante (= resume_at). L'explosion a lieu entre +min et +max. */
  fuse_started_at: string
  min_fuse_ms: number
  max_fuse_ms: number
  grace_ms: number
  winner: string | null
  /** Classement final (ids), présent en fin de partie. */
  ranking?: string[]
}

/** p_options de start_match('bombe-a-mots'). */
export interface BamStartOptions {
  lives: number
  start_level: number
  /** Triées par difficulté croissante, mélangées à niveau égal (10..400). */
  syllables: { s: string; level: number }[]
}

/**
 * Actions :
 * - {type:'word', word, n} : joueur actif. Erreurs : not_your_turn, not_alive, too_late (n périmé),
 *   bomb_paused, invalid_word, word_missing_syllable, word_too_short, word_already_played.
 *   Si l'échéance est dépassée, le serveur fait exploser la bombe (pas d'erreur).
 * - {type:'tick', n?, quiet?} : n'importe qui. Explosion si l'échéance (cachée) est passée.
 *   quiet:true => lève 'bomb_not_ready' si trop tôt (rien n'est écrit) ; sinon state inchangé.
 */
export type BamAction =
  | { type: 'word'; word: string; n: number }
  | { type: 'tick'; n?: number; quiet?: boolean }

/** Messages éphémères (broadcast Realtime `match:<id>`, aucune BDD). */
export type BamBroadcast =
  | { event: 'typing'; payload: { p: string; n: number; t: string } }
  | { event: 'reject'; payload: { p: string; n: number; w: string; reason: string } }
