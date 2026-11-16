// =============================================================================
// Types de la base Supabase — écrits à la main, alignés sur supabase/schema.sql.
// Contrat des jeux : supabase/README.md.
// Usage : createClient<Database>(url, key)
// =============================================================================

export type UUID = string;
export type Timestamp = string; // ISO 8601

export type GameId = 'qui-de-nous' | 'undercover';

export type ExpressionId =
  | 'joie' | 'colere' | 'pleurs' | 'boude' | 'reflexion' | 'dodo' | 'bisou'
  | 'clin_oeil' | 'surprise' | 'amoureux' | 'cool' | 'gamer'
  | 'pouces' | 'timide' | 'charmee' | 'determine';

export type ProfileSlug =
  | 'kevin' | 'cycy' | 'dede' | 'manon' | 'mika' | 'cecile' | 'carole' | 'marius' | 'nini';

/** Map profile_id -> expressions nouvellement débloquées (entrées non vides seulement). */
export type NewUnlocks = Record<UUID, ExpressionId[]>;

/** Id d'une tenue (catalogue : table `tenues`, miroir src/data/tenues.ts). 'default' = tenue de base. */
export type TenueId = string;

/** Map profile_id -> tenues nouvellement débloquées (entrées non vides seulement). */
export type NewTenues = Record<UUID, TenueId[]>;

// -----------------------------------------------------------------------------
// Tables (lignes lisibles par le client ; aucune écriture directe : tout passe par RPC)
// -----------------------------------------------------------------------------

export type ProfileRow = {
  id: UUID;
  slug: ProfileSlug;
  first_name: string;
  nickname: string;
  is_admin: boolean;
  equipped_expression: ExpressionId;
  equipped_tenue: TenueId;
  expressions: ExpressionId[];
  xp: number;
  sort_order: number;
  created_at: Timestamp;
};

/** Profil renvoyé par les RPC (login_profile, update_nickname, equip_expression). */
export type ProfileJson = ProfileRow & {
  level: number;
};

export type DeviceSessionRow = {
  auth_uid: UUID;
  profile_id: UUID;
  created_at: Timestamp;
};

export type FriendshipStatus = 'pending' | 'accepted';

export type FriendshipRow = {
  requester_id: UUID;
  addressee_id: UUID;
  status: FriendshipStatus;
  created_at: Timestamp;
  accepted_at: Timestamp | null;
};

export type SoireeStatus = 'lobby' | 'active' | 'ended';

/**
 * Raison de fin d'une soirée : 'host' (end_soiree), 'empty' (le dernier joueur est
 * parti), 'idle' (fin auto : 20 min sans jeu), 'abandoned' (filet : partie figée 3 h).
 */
export type SoireeEndReason = 'host' | 'empty' | 'idle' | 'abandoned';

export type SoireeRow = {
  id: UUID;
  code: string; // 4 lettres majuscules (sans I, L, O)
  host_id: UUID;
  status: SoireeStatus;
  /** null tant que la soirée n'est pas terminée (ou terminée avant l'ajout de la colonne). */
  end_reason: SoireeEndReason | null;
  created_at: Timestamp;
  started_at: Timestamp | null;
  /** Fin auto 'idle' : l'échéance d'inactivité (pas l'heure du nettoyage). */
  ended_at: Timestamp | null;
};

/** Partie non terminée la plus récente d'une soirée (`SoireeJson.current_match`). */
export type SoireeCurrentMatch = {
  id: UUID;
  game_id: string;
  status: MatchStatus;
  created_at: Timestamp;
  /** `state.players` de la partie. */
  player_ids: UUID[];
};

/** Soirée renvoyée par create_soiree / join_soiree_by_code / my_active_soiree(s). */
export type SoireeJson = SoireeRow & {
  player_ids: UUID[];
  /** Dernière activité : création, démarrage ou fin/annulation de la dernière partie. */
  last_activity_at: Timestamp;
  /** null = pas de partie en cours (« dans le salon »). */
  current_match: SoireeCurrentMatch | null;
  /** Fin automatique prévue (last_activity_at + 20 min) ; null si partie en cours ou soirée terminée. */
  idle_deadline: Timestamp | null;
};

/** Élément de my_active_soirees() (la plus récente d'abord, 5 au plus). */
export type ActiveSoireeJson = SoireeJson & {
  /** Profil de l'hôte (null : repli sur un ancien serveur). */
  host: ProfileJson | null;
  /** Mon arrivée dans la soirée. */
  joined_at: Timestamp;
};

export type SoireePlayerRow = {
  soiree_id: UUID;
  profile_id: UUID;
  joined_at: Timestamp;
};

export type MatchStatus = 'lobby' | 'playing' | 'finished';

export type MatchRow<S extends GameState = GameState> = {
  id: UUID;
  soiree_id: UUID;
  game_id: GameId;
  status: MatchStatus;
  state: S;
  created_at: Timestamp;
  finished_at: Timestamp | null;
  /** Dernière écriture de la ligne (trigger) : filet « partie figée depuis 3 h ». */
  updated_at: Timestamp;
};

export type MatchPlayerRow = {
  match_id: UUID;
  profile_id: UUID;
  game_id: GameId;
  placement: number; // 1 = meilleur
  points: number;
  won: boolean;
  /** Stats propres au jeu (jeux en duel : { duel_wins }). */
  stats: { duel_wins?: number } & Record<string, unknown>;
};

export type MatchSecretRow<S = UndercoverSecret> = {
  match_id: UUID;
  profile_id: UUID;
  secret: S;
};

export type TenueRow = {
  id: TenueId;
  label: string;
  emoji: string;
  /** Jeu dont il faut gagner des parties ; null = tous jeux confondus. */
  game_id: string | null;
  /** 'default' | 'game_wins' | 'duel_wins' (extensible). */
  condition_type: string;
  threshold: number;
  sort_order: number;
  has_art: boolean;
};

export type TenueUnlockRow = {
  profile_id: UUID;
  tenue_id: TenueId;
  unlocked_at: Timestamp;
};

export type UnlockRow = {
  profile_id: UUID;
  expression: ExpressionId;
  unlocked_at: Timestamp;
};

export type PlayerStatsRow = {
  profile_id: UUID;
  games_played: number;
  wins: number;
  losses: number;
  loss_streak: number;
  max_loss_streak: number;
  last_place_count: number;
  qui_de_nous_played: number;
  undercover_played: number;
  undercover_won_as_undercover: number;
  undercover_first_out: number;
  designated_total: number;
  soirees_count: number;
  late_soirees_count: number;
  updated_at: Timestamp;
};

export type LeaderboardGeneralRow = {
  profile_id: UUID;
  slug: ProfileSlug;
  first_name: string;
  nickname: string;
  equipped_expression: ExpressionId;
  equipped_tenue: TenueId;
  xp: number;
  level: number;
  wins: number;
  games_played: number;
  rank: number;
};

export type LeaderboardByGameRow = {
  game_id: GameId;
  profile_id: UUID;
  slug: ProfileSlug;
  first_name: string;
  nickname: string;
  equipped_expression: ExpressionId;
  equipped_tenue: TenueId;
  games_played: number;
  wins: number;
  points_total: number;
  rank: number;
};

export type PublicProfile = {
  id: UUID;
  slug: ProfileSlug;
  first_name: string;
  nickname: string;
  equipped_expression: ExpressionId;
  equipped_tenue: TenueId;
  expressions: ExpressionId[];
  has_pin: boolean;
};

// -----------------------------------------------------------------------------
// État public commun
// -----------------------------------------------------------------------------

export type MatchResult = {
  profile_id: UUID;
  points: number;
  won: boolean;
  placement: number;
  stats: Record<string, number>;
};

/** Champs ajoutés par le serveur à la fin (phase 'finished'). */
export type FinishedExtras = {
  new_unlocks?: NewUnlocks;
  new_tenues?: NewTenues;
  xp_gained?: Record<UUID, number>;
  /** true si la partie a été annulée (action abort ou fin de soirée). */
  aborted?: boolean;
};

// -----------------------------------------------------------------------------
// Jeu « qui-de-nous »
// -----------------------------------------------------------------------------

export type QuiDeNousPhase = 'voting' | 'reveal' | 'finished' | 'aborted';

export type QuiDeNousReveal = {
  round: number;
  question: string;
  /** voter_id -> target_id (révélé seulement après la manche) */
  votes: Record<UUID, UUID>;
  /** target_id -> nombre de votes reçus (seuls les joueurs ayant reçu ≥1 vote) */
  counts: Record<UUID, number>;
  /** joueur(s) majoritaire(s) ; vide si aucun vote */
  majority: UUID[];
  /** votants ayant gagné 1 point cette manche */
  scorers: UUID[];
};

export type QuiDeNousState = FinishedExtras & {
  game: 'qui-de-nous';
  phase: QuiDeNousPhase;
  round: number;          // 1-based
  total_rounds: number;
  question: string;
  players: UUID[];
  /** Qui a déjà voté pendant 'voting' (jamais pour qui). */
  voters: UUID[];
  scores: Record<UUID, number>;
  /** Votes reçus cumulés. */
  designated: Record<UUID, number>;
  last_reveal: QuiDeNousReveal | null;
  history: Array<Pick<QuiDeNousReveal, 'round' | 'question' | 'counts' | 'majority'>>;
  winners: UUID[] | null;
  results: MatchResult[] | null;
};

export type QuiDeNousOptions = {
  rounds?: number;       // défaut 10, borné 1..50 et au nombre de questions
  questions: string[];   // tirées côté front, dans l'ordre de jeu
  player_ids?: UUID[];   // sous-ensemble des joueurs de la soirée (optionnel)
};

export type QuiDeNousAction =
  | { type: 'vote'; target: UUID }  // joueur, phase voting ; revote possible tant que pas révélé
  | { type: 'reveal' }              // hôte, force la révélation
  | { type: 'next' }                // hôte, phase reveal -> manche suivante ou fin
  | { type: 'abort' };              // hôte

// -----------------------------------------------------------------------------
// Jeu « undercover »
// -----------------------------------------------------------------------------

export type UndercoverRole = 'civil' | 'undercover' | 'mrwhite';
export type UndercoverPhase =
  | 'describe' | 'vote' | 'elimination' | 'mrwhite_guess' | 'finished' | 'aborted';
export type UndercoverWinner = 'civils' | 'infiltres' | 'mrwhite';

export type UndercoverElimination = {
  profile_id: UUID;
  role: UndercoverRole;
  round: number;
};

export type UndercoverVoteResult = {
  round: number;
  votes: Record<UUID, UUID>;
  counts: Record<UUID, number>;   // candidat -> votes (inclut les 0)
  outcome: 'majority' | 'revote' | 'random';
  tied: UUID[];
};

export type UndercoverState = FinishedExtras & {
  game: 'undercover';
  phase: UndercoverPhase;
  round: number;
  players: UUID[];
  /** Ordre de parole complet (Mister White jamais premier). */
  order: UUID[];
  /** Joueurs encore en jeu, dans l'ordre de parole. */
  alive: UUID[];
  /** Premier à parler cette manche (tourne à chaque manche). */
  starter: UUID;
  setup: { civils: number; undercovers: number; mister_white: boolean };
  voters: UUID[];
  /** Candidats éliminables pendant 'vote' (tous les vivants, ou ex-aequo en revote). */
  candidates: UUID[];
  revote: boolean;
  last_vote: UndercoverVoteResult | null;
  eliminated: UndercoverElimination[];
  current_elimination: UndercoverElimination | null;
  mrwhite_guess: { profile_id: UUID; word: string | null; correct: boolean } | null;
  winner: UndercoverWinner | null;
  /** null jusqu'à la fin de partie. */
  words: { civil: string; undercover: string } | null;
  /** null jusqu'à la fin de partie. */
  roles: Record<UUID, UndercoverRole> | null;
  results: Array<MatchResult & { role: UndercoverRole }> | null;
};

/** Contenu de match_secrets.secret pour Undercover (lisible par son seul propriétaire). */
// Civils et undercovers ne reçoivent que leur mot (ils ignorent leur rôle).
export type UndercoverSecret =
  | { word: string; role?: undefined }
  | { role: 'mrwhite'; word: null };

export type UndercoverOptions = {
  pair: [string, string];  // [motA, motB] ; le serveur tire au sort lequel est le mot civil
  misterWhite?: boolean;   // ignoré si < 5 joueurs
  player_ids?: UUID[];
};

export type UndercoverAction =
  | { type: 'start_vote' }              // hôte, describe -> vote
  | { type: 'vote'; target: UUID }      // joueur vivant, phase vote, cible ∈ candidates
  | { type: 'close_vote' }              // hôte, dépouille avec les votes déjà reçus
  | { type: 'guess'; word: string }     // Mister White éliminé, phase mrwhite_guess
  | { type: 'skip_guess' }              // hôte, Mister White ne devine pas
  | { type: 'next' }                    // hôte, elimination -> manche suivante ou fin
  | { type: 'abort' };                  // hôte

// -----------------------------------------------------------------------------
// Unions
// -----------------------------------------------------------------------------

export type GameState = QuiDeNousState | UndercoverState;
export type GameAction = QuiDeNousAction | UndercoverAction;
export type GameOptions = QuiDeNousOptions | UndercoverOptions;

// -----------------------------------------------------------------------------
// Retours des RPC
// -----------------------------------------------------------------------------

export type LoginResult =
  | { ok: true; first_login: boolean; profile: ProfileJson }
  | { ok: false; error: 'invalid_pin_format' | 'unknown_profile' }
  | { ok: false; error: 'wrong_pin'; attempts_left: number }
  | { ok: false; error: 'locked'; locked_until: Timestamp };

export type FriendRequestResult = {
  status: 'pending' | 'accepted' | 'rejected';
  new_unlocks: NewUnlocks;
};

export type EndSoireeResult = {
  new_unlocks: NewUnlocks;
};

/** Codes d'erreur levés par les RPC (error.message côté supabase-js). */
export type RpcErrorCode =
  | 'not_authenticated' | 'not_logged_in' | 'forbidden' | 'unknown_profile'
  | 'invalid_nickname' | 'unknown_expression' | 'expression_locked' | 'unknown_tenue' | 'tenue_locked'
  | 'invalid_friend' | 'no_pending_request'
  // already_in_soiree : ancien serveur (une seule soirée) ; remplacé par too_many_soirees.
  // player_busy : un invité est déjà dans 5 soirées (pseudos dans error.details).
  | 'too_many_soirees' | 'already_in_soiree' | 'player_busy' | 'soiree_not_found' | 'soiree_ended' | 'not_host'
  | 'match_in_progress' | 'player_not_in_soiree' | 'unknown_game' | 'not_enough_players'
  | 'missing_questions' | 'invalid_questions' | 'invalid_pair'
  | 'match_not_found' | 'match_not_playing' | 'not_in_match' | 'invalid_action' | 'unknown_action'
  | 'wrong_phase' | 'not_a_player' | 'not_alive' | 'invalid_target' | 'cannot_vote_self'
  | 'not_your_guess' | 'invalid_guess' | 'code_generation_failed';

// -----------------------------------------------------------------------------
// Database (format attendu par createClient<Database>)
// -----------------------------------------------------------------------------

type Table<R> = {
  Row: R;
  Insert: Partial<R>;
  Update: Partial<R>;
  Relationships: [];
};
type View<R> = { Row: R; Relationships: [] };

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      device_sessions: Table<DeviceSessionRow>;
      friendships: Table<FriendshipRow>;
      soirees: Table<SoireeRow>;
      soiree_players: Table<SoireePlayerRow>;
      matches: Table<MatchRow>;
      match_players: Table<MatchPlayerRow>;
      match_secrets: Table<MatchSecretRow>;
      unlocks: Table<UnlockRow>;
      tenues: Table<TenueRow>;
      tenue_unlocks: Table<TenueUnlockRow>;
      player_stats: Table<PlayerStatsRow>;
    };
    Views: {
      leaderboard_general: View<LeaderboardGeneralRow>;
      leaderboard_by_game: View<LeaderboardByGameRow>;
    };
    Functions: {
      list_profiles_public: { Args: Record<string, never>; Returns: PublicProfile[] };
      login_profile: { Args: { p_slug: string; p_pin: string }; Returns: LoginResult };
      current_profile_id: { Args: Record<string, never>; Returns: UUID | null };
      logout_device: { Args: Record<string, never>; Returns: undefined };
      admin_reset_pin: { Args: { p_slug: string }; Returns: undefined };
      update_nickname: { Args: { p_nickname: string }; Returns: ProfileJson };
      equip_expression: { Args: { p_expression: ExpressionId }; Returns: ProfileJson };
      equip_tenue: { Args: { p_tenue: TenueId }; Returns: ProfileJson };
      level_for_xp: { Args: { p_xp: number }; Returns: number };
      is_soiree_member: { Args: { p_soiree_id: UUID }; Returns: boolean };

      send_friend_request: { Args: { p_profile_id: UUID }; Returns: FriendRequestResult };
      respond_friend_request: { Args: { p_requester_id: UUID; p_accept: boolean }; Returns: FriendRequestResult };
      remove_friend: { Args: { p_profile_id: UUID }; Returns: undefined };

      /** Compat : la soirée non terminée la plus récemment rejointe. */
      my_active_soiree: { Args: Record<string, never>; Returns: SoireeJson | null };
      /** Toutes mes soirées non terminées (≤ 5), la plus récente d'abord. */
      my_active_soirees: { Args: Record<string, never>; Returns: ActiveSoireeJson[] };
      create_soiree: { Args: { p_player_ids: UUID[] }; Returns: SoireeJson };
      join_soiree_by_code: { Args: { p_code: string }; Returns: SoireeJson };
      /** Sans p_soiree_id (compat) : la soirée la plus récemment rejointe. */
      leave_soiree: { Args: { p_soiree_id?: UUID | null }; Returns: undefined };
      end_soiree: { Args: { p_soiree_id: UUID }; Returns: EndSoireeResult };

      start_match: { Args: { p_soiree_id: UUID; p_game_id: GameId; p_options: GameOptions }; Returns: UUID };
      game_action: { Args: { p_match_id: UUID; p_action: GameAction }; Returns: GameState };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

/** Niveau = floor(sqrt(xp / 100)) + 1 (identique à level_for_xp côté SQL). */
export const levelForXp = (xp: number): number => Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
