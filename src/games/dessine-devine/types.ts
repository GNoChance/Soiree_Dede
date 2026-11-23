/**
 * Types de « Dessine & devine » (contrat avec supabase/games/dessine-devine.sql).
 *
 * STATE PUBLIC (matches.state) — le mot n'y apparaît JAMAIS avant la phase `reveal` :
 *   phase      'choosing' (15 s, le dessinateur choisit parmi 3 mots)
 *            | 'drawing'  (draw_seconds, les autres devinent)
 *            | 'reveal'   (4 s, mot révélé dans `hint` + `last_turn.word`)
 *            | 'finished' | 'aborted'
 *   deadline   échéance ISO de la phase en cours → `{"type":"tick"}` par n'importe qui
 *   next_hint_at  échéance ISO du prochain indice (phase drawing) → tick aussi
 *   hint       masque du mot : '_' = lettre cachée, séparateurs (espace, -, ') et
 *              lettres révélées en clair. En `reveal` : le mot complet.
 *
 * SECRETS (match_secrets, mis à jour en cours de partie — le front les relit lui-même) :
 *   dessinateur : {turn, role:'drawer', choices:[{word,aliases,difficulty}x3], word:null|'chat', aliases?}
 *   devineur    : {turn, role:'guesser', found:true, word}                 après avoir trouvé
 *                 {turn, role:'guesser', found:false, close:{text, n}}    « Presque ! » (privé)
 *   Un secret dont `turn` ≠ state.turn est périmé (les secrets ne sont jamais effacés).
 *
 * ACTIONS : choose_word {index 0-2} (dessinateur) · guess {text} (devineurs) ·
 *           drawing_started (dessinateur, 1er trait, idempotent) · tick · skip_turn (hôte).
 *           Sans drawing_started 25 s après le début du dessin, tick passe le tour (last_turn.idle).
 *
 * BROADCAST (canal Realtime `match:<matchId>`, éphémère, voir channel.ts) : DrawMessage.
 */

export type DrawPhase = 'choosing' | 'drawing' | 'reveal' | 'finished' | 'aborted'
export type Difficulty = 'facile' | 'mixte' | 'difficile'

export interface WordChoice {
  word: string
  aliases: string[]
  difficulty: 1 | 2 | 3
}

export interface FeedEntry {
  /** Numéro unique croissant (clé React). */
  n: number
  /** Joueur. */
  p: string
  /** 'guess' = proposition fausse (texte public) ; 'found' = a trouvé (texte masqué). */
  k: 'guess' | 'found'
  t?: string
  pts?: number
}

export interface TurnSummary {
  turn: number
  drawer: string
  word: string | null
  found: string[]
  points?: Record<string, number>
  skipped: boolean
  /** Tour passé parce que le dessinateur n'a rien dessiné (absent). */
  idle?: boolean
}

export interface DrawState {
  game: 'dessine-devine'
  phase: DrawPhase
  players: string[]
  /** Ordre de passage des dessinateurs (tiré au sort). */
  order: string[]
  round: number
  total_rounds: number
  turn: number
  total_turns: number
  difficulty: Difficulty
  draw_seconds: number
  choose_seconds: number
  reveal_seconds: number
  drawer: string
  deadline: string | null
  started_at: string | null
  /** Premier trait posé ? (absent sur les anciennes parties). */
  drawn?: boolean
  /** Échéance de la vérification « le dessinateur dessine-t-il ? » (null = pas/plus de contrôle). */
  draw_check_at?: string | null
  next_hint_at: string | null
  hint: string | null
  word_length: number | null
  found: string[]
  turn_points: Record<string, number>
  feed: FeedEntry[]
  feed_seq: number
  scores: Record<string, number>
  last_turn: TurnSummary | null
  history: TurnSummary[]
  winners: string[] | null
  results: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
  seq?: number
  aborted?: boolean
}

export interface DrawSecret {
  turn: number
  role: 'drawer' | 'guesser'
  choices?: WordChoice[]
  word?: string | null
  aliases?: string[]
  found?: boolean
  close?: { text: string; n: number }
}

/* -------------------------------------------------------------------------- */
/* Dessin                                                                      */
/* -------------------------------------------------------------------------- */

/** Un trait : coordonnées normalisées 0-1 à plat [x0, y0, x1, y1, …]. */
export interface Stroke {
  id: string
  /** Couleur CSS. */
  c: string
  /** Épaisseur relative à la largeur du canvas. */
  w: number
  /** Gomme (peint en blanc). */
  e?: boolean
  p: number[]
}

/** Morceau de trait diffusé : `n` = index (en points) du premier point de `p`. */
export interface StrokeChunk {
  id: string
  c: string
  w: number
  e?: boolean
  n: number
  p: number[]
}

/** Messages du canal broadcast `match:<matchId>` (tous portent `turn`). */
export type DrawMessage =
  | { event: 'pts'; payload: { turn: number; ops: StrokeChunk[] } }
  | { event: 'undo'; payload: { turn: number; id: string } }
  | { event: 'clear'; payload: { turn: number } }
  | { event: 'sync_request'; payload: { turn: number; from: string; fromDrawer: boolean } }
  | { event: 'sync'; payload: { turn: number; from: string; strokes: Stroke[] } }
  | { event: 'snapshot'; payload: { turn: number; drawer: string; word: string | null; data: string } }

export type DrawEvent = DrawMessage['event']
