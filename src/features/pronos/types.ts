/** Miroirs TS des RPC de supabase/features/pronos.sql (non typées dans src/types/db.ts). */

/** Manche de pronostics ouverte par l'hôte avant le lancement d'un jeu. */
export interface PronoRound {
  soiree_id: string
  game_id: string
  /** Joueurs de la manche = choix possibles. */
  player_ids: string[]
  /** Nombre de joueurs qui ont déjà parié. */
  bets: number
  opened_at: string
}

/** get_pronos : jamais les paris des autres. */
export interface PronosState {
  round: PronoRound | null
  my_pick: string | null
}

/** match_pronos : null = aucun pari ; void = annulé (partie annulée / sans gagnant / pas finie). */
export interface MatchPronos {
  void: boolean
  picks: { profile_id: string; pick: string; ok: boolean }[]
}

/** soiree_prono_board : classement « Meilleur devin » de la soirée. */
export interface DevinRow {
  profile_id: string
  hits: number
  bets: number
}

/** Une manche non lancée expire côté serveur au bout de 10 minutes. */
export const PRONOS_TTL_MS = 10 * 60 * 1000
