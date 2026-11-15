import type { ComponentType } from 'react'

/**
 * Contrat d'un module de jeu. Ajouter un jeu = un dossier `src/games/<id>/`
 * avec un `index.ts` qui exporte `definition` (auto-découvert par registry.ts)
 * + un fichier `supabase/games/<id>.sql` avec `game_<id_underscore>_start/_action`.
 */

/** Joueur tel que vu par les jeux (annuaire des profils). */
export interface PlayerInfo {
  id: string
  slug: string
  nickname: string
  firstName: string
  /** Toutes les expressions du perso (utilisables en jeu même verrouillées). */
  expressions: string[]
  equipped: string
  /** Tenue équipée (id du catalogue src/data/tenues.ts). */
  equippedTenue: string
  color: string
}

/** Action envoyée à `game_action` (toujours un objet avec `type`). */
export type GameActionPayload = { type: string } & Record<string, unknown>

/** État public commun minimal (chaque jeu a le sien, cf. src/types/db.ts). */
export interface BaseGameState {
  game: string
  phase: string
  round?: number
  total_rounds?: number
  players: string[]
  /** Version monotone du state (ajoutée par game_action). */
  seq?: number
  aborted?: boolean
  results?: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
  new_unlocks?: Record<string, string[]>
  /** Tenues nouvellement débloquées : {profile_id: [tenue_id]}. */
  new_tenues?: Record<string, string[]>
  xp_gained?: Record<string, number>
}

/** Props passées au composant Play d'un jeu par MatchPage. */
export interface GamePlayProps {
  matchId: string
  soireeId: string
  /** State public (à caster vers le type du jeu). */
  state: BaseGameState
  /** Mon secret (`match_secrets.secret`) ou null. */
  secret: unknown
  meId: string
  isHost: boolean
  /** Annuaire id -> joueur. */
  players: Record<string, PlayerInfo>
  /** Envoie une action ; renvoie le nouveau state ou null en cas d'erreur (déjà toastée). */
  act: (action: GameActionPayload) => Promise<BaseGameState | null>
  /** Une action est en cours d'envoi. */
  pending: boolean
  /** Retour au salon. */
  onExit?: () => void
}

/** Props passées au composant d'options (écran de lancement par l'hôte). */
export interface GameOptionsProps {
  options: Record<string, unknown>
  onChange: (options: Record<string, unknown>) => void
  playerCount: number
}

/** Bloc spécifique au jeu affiché sur l'écran de résultats commun. */
export interface GameSummaryProps {
  state: BaseGameState
  meId: string
  players: Record<string, PlayerInfo>
}

export interface StartContext {
  /** Joueurs qui vont jouer (sous-sélection éventuelle). */
  playerIds: string[]
}

export interface GameDefinition {
  /** 'qui-de-nous' | 'undercover' (= p_game_id de start_match) */
  id: string
  /** Ordre d'affichage dans le hub (petit = en premier). */
  order?: number
  name: string
  tagline: string
  emoji: string
  /** Couleur d'accent de la carte */
  color: string
  minPlayers: number
  maxPlayers: number
  /** Règles en 2-3 phrases (salon). */
  rules?: string
  Play: ComponentType<GamePlayProps>
  Options?: ComponentType<GameOptionsProps>
  Summary?: ComponentType<GameSummaryProps>
  defaultOptions?: Record<string, unknown>
  /**
   * Construit `p_options` de start_match à partir des options de l'écran de
   * lancement (tirage des questions, des mots…). `player_ids` est ajouté ensuite.
   */
  prepareStart?: (options: Record<string, unknown>, ctx: StartContext) => Promise<Record<string, unknown>>
  /** Libellé de la manche dans l'en-tête (défaut : « Manche n/total »). */
  roundLabel?: (state: BaseGameState) => string | null
}
