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
  | 'pouces' | 'timide' | 'charmee';

export type ProfileSlug =
  | 'kevin' | 'cycy' | 'dede' | 'manon' | 'mika' | 'cecile' | 'carole' | 'marius' | 'nini';

/** Map profile_id -> expressions nouvellement débloquées (entrées non vides seulement). */
export type NewUnlocks = Record<UUID, ExpressionId[]>;

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

export type SoireeRow = {
  id: UUID;
  code: string; // 4 lettres majuscules (sans I, L, O)
  host_id: UUID;
  status: SoireeStatus;
  created_at: Timestamp;
  started_at: Timestamp | null;
  ended_at: Timestamp | null;
};

/** Soirée renvoyée par create_soiree / join_soiree_by_code / my_active_soiree. */
export type SoireeJson = SoireeRow & {
  player_ids: UUID[];
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
};

export type MatchPlayerRow = {
  match_id: UUID;
  profile_id: UUID;
  game_id: GameId;
  placement: number; // 1 = meilleur
  points: number;
  won: boolean;
};

export type MatchSecretRow<S = UndercoverSecret> = {
  match_id: UUID;
  profile_id: UUID;
  secret: S;
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
export type UndercoverSecret = {
  role: UndercoverRole;
  word: string | null; // null pour Mister White
};

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
  | 'invalid_nickname' | 'unknown_expression' | 'expression_locked'
  | 'invalid_friend' | 'no_pending_request'
  | 'already_in_soiree' | 'player_busy' | 'soiree_not_found' | 'soiree_ended' | 'not_host'
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
      level_for_xp: { Args: { p_xp: number }; Returns: number };
      is_soiree_member: { Args: { p_soiree_id: UUID }; Returns: boolean };

      send_friend_request: { Args: { p_profile_id: UUID }; Returns: FriendRequestResult };
      respond_friend_request: { Args: { p_requester_id: UUID; p_accept: boolean }; Returns: FriendRequestResult };
      remove_friend: { Args: { p_profile_id: UUID }; Returns: undefined };

      my_active_soiree: { Args: Record<string, never>; Returns: SoireeJson | null };
      create_soiree: { Args: { p_player_ids: UUID[] }; Returns: SoireeJson };
      join_soiree_by_code: { Args: { p_code: string }; Returns: SoireeJson };
      leave_soiree: { Args: Record<string, never>; Returns: undefined };
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
