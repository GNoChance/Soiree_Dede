/**
 * Contrat « Le Tour des Potes » (id `tour-des-potes`) — miroir de
 * supabase/games/tour-des-potes.sql. State public = TdpState (`matches.state`),
 * aucun secret (`match_secrets` inutilisé). Plateau (noms, anecdotes,
 * économie) : ./board.ts. Helpers purs : ./rules.ts.
 *
 * DÉROULÉ D'UN TOUR (joueur `turn`) :
 *   phase `roll`  → {type:'roll'} : dés serveur ; déplacement ; résolution
 *                   automatique (loyer, taxe, « Direction le violon ») ;
 *   phase `card`  → case Hasard / Entre potes atteinte DIRECTEMENT par les
 *                   dés (lancer normal ou sortie du violon en lançant) : en
 *                   attente de pioche, `pending` = {cell, deck} ; le joueur
 *                   envoie {type:'draw'} → la carte est tirée et appliquée
 *                   (`last_event.card` rempli, évènement 'card' dans
 *                   `events`), puis la suite normale (buy si la carte mène à
 *                   un lieu libre, roll après un double, sinon manage…).
 *                   Une carte qui renvoie sur une autre case carte est
 *                   appliquée aussitôt (pas de nouvelle phase card).
 *                   `last_event.no` ne change pas à la pioche (pas de dés).
 *   phase `buy`   → lieu libre atteint : {type:'buy'} ou {type:'pass'} ;
 *   phase `manage`→ construire / vendre puis {type:'end_turn'} ;
 *   après un DOUBLE (et hors violon) la phase redevient `roll` (on rejoue ;
 *   `doubles` = nombre de doubles du tour ; au 3e → violon sans bouger).
 *   phase `jail`  → début de tour au violon : {type:'pay_jail'} (50 €),
 *                   {type:'use_card'} (carte « Sortie du violon »), ou
 *                   {type:'roll'} = tenter un double (3e échec : paie 50 € et
 *                   avance). Après pay_jail / use_card → phase `roll`.
 *   phase `debt`  → le joueur au trait a un argent négatif : il vend des
 *                   bâtiments ({type:'sell'}) ; dès que l'argent ≥ 0 la partie
 *                   reprend (roll si double en cours, sinon manage). Si même
 *                   en vendant tout il ne pouvait pas payer, la faillite est
 *                   immédiate (pas de phase debt).
 *   `build`/`sell` sont aussi permis en `roll` et `jail` (avant de lancer),
 *   jamais en `card` ni en `buy`.
 *
 * MINUTEUR : `deadline` (ISO, null si `turn_seconds` = 0). N'importe quel
 * client envoie {type:'tick'} à l'échéance (sans effet avant) → décision
 * automatique : roll → lance ; jail → tente le double ; card → pioche ; buy → passe ;
 * manage → fin du tour ; debt → vend automatiquement (ou faillite).
 * HÔTE : {type:'skip'} → le joueur au trait est marqué absent (`away`) et
 * son tour est joué automatiquement ; ses tours suivants aussi, jusqu'à ce
 * qu'il envoie une action (ou {type:'back'}).
 *
 * FIN : `format` chrono (à `ends_at`, on termine le tour du joueur en cours ;
 * `last_turn` passe à true), tours (`total_rounds` tours de table), classique
 * (dernier joueur en lice ; filet `ends_at` = départ + 3 h). Classement par
 * fortune = argent + prix des lieux + prix des bâtiments (cf. `ranking`).
 */

import type { CellType } from './board.ts'

export type TdpPhase = 'roll' | 'jail' | 'card' | 'buy' | 'manage' | 'debt' | 'finished' | 'aborted'
export type TdpFormat = 'chrono' | 'tours' | 'classique'
export type TdpDeck = 'hasard' | 'potes'
export type TdpCardKind =
  | 'move_to'
  | 'move_by'
  | 'nearest'
  | 'jail'
  | 'jail_card'
  | 'gain'
  | 'pay'
  | 'collect_each'
  | 'pay_each'
  | 'repairs'
  /** Cartes persos : le pote nommé te donne / tu donnes au pote (la banque s'il ne joue pas). */
  | 'friend_gain'
  | 'friend_pay'
export type TdpEndReason = 'last_standing' | 'rounds' | 'time' | 'safety'

/** Carte tirée (texte original fourni par le serveur). */
export interface TdpCardDrawn {
  deck: TdpDeck
  /** 'hNN' (Hasard), 'pNN' (Entre potes). */
  id: string
  text: string
  kind: TdpCardKind
  /** Montant total calculé (gain, pay, repairs, collect_each, pay_each) ou null. */
  amount: number | null
}

/**
 * Dernier lancer et ses conséquences : à afficher sur TOUS les écrans
 * (anecdote de `BOARD[cell]`, loyer payé, carte…). Recréé à chaque lancer.
 */
/** Offre d'achat (phase buy). */
export interface TdpPendingBuy {
  cell: number
  price: number
}

/** Pioche en attente (phase card) : case atteinte et paquet à piocher. */
export interface TdpPendingCard {
  cell: number
  deck: TdpDeck
}

export interface TdpLastEvent {
  /** Numéro de l'évènement `roll` dans le journal (change à chaque lancer → anim). */
  no: number
  turn_no: number
  player: string
  dice: [number, number]
  double: boolean
  /** Case de départ. */
  from: number
  /** Case finale (après carte / violon). */
  cell: number
  passed_go: boolean
  /** Loyer payé (au propriétaire `to`). */
  rent: { to: string; amount: number } | null
  /** Taxe payée. */
  tax: number | null
  /** Cagnotte des taxes ramassée sur « Pause apéro » (absent si rien ramassé). */
  pot?: number
  /** Carte tirée (la dernière si plusieurs). null en phase card (pas encore piochée). */
  card: TdpCardDrawn | null
  /** Le joueur a acheté la case atteinte. */
  bought: boolean
  /**
   * Violon : 'triple' (3e double), 'case' (Direction le violon), 'card' (carte),
   * 'stay' (raté le double), 'out_double' / 'out_forced' (sorti en lançant), null.
   */
  jail: 'triple' | 'case' | 'card' | 'stay' | 'out_double' | 'out_forced' | null
}

export type TdpEventKind =
  | 'turn' // début de tour {player, round, turn_no}
  | 'roll' // {dice, from, cell (destination prévue), double, doubles?, jail_attempt?}
  | 'pass_go' // {amount: 200}
  | 'move' // déplacement par carte {from, cell}
  | 'rent' // {cell, amount, to}
  | 'tax' // {cell, amount}
  | 'pot' // cagnotte des taxes ramassée sur Pause apéro {cell: 20, amount}
  | 'card' // {deck, card, text, card_kind, amount}
  | 'jail' // {reason: 'triple'|'case'|'card', cell: 10}
  | 'jail_stay' // {jail_attempt}
  | 'jail_out' // {how: 'pay'|'card'|'double'|'forced', amount?, card?}
  | 'buy' // {cell, amount}
  | 'pass_buy' // {cell}
  | 'build' // {cell, level (1-4 maisons, 5 = hôtel), amount}
  | 'sell' // {cell, level (après vente), amount (remboursé), auto?}
  | 'debt' // {amount (dû)}
  | 'bankrupt' // {amount (argent au moment de la faillite)}
  | 'auto' // décision automatique (minuteur / absent) {phase}
  | 'away' // l'hôte a marqué le joueur absent
  | 'back' // le joueur est revenu
  | 'finish' // {reason}

/** Entrée du journal. Champs présents selon `kind` (cf. TdpEventKind). */
export interface TdpEvent {
  /** Numéro croissant (unique dans la partie). */
  no: number
  kind: TdpEventKind
  /** Joueur concerné (null pour 'finish'). */
  player: string | null
  cell?: number
  from?: number
  amount?: number | null
  /** Bénéficiaire d'un loyer. */
  to?: string
  dice?: [number, number]
  double?: boolean
  doubles?: number
  jail_attempt?: number
  deck?: TdpDeck
  /** Id de carte. */
  card?: string
  text?: string
  card_kind?: TdpCardKind
  level?: number
  auto?: boolean
  reason?: string
  how?: 'pay' | 'card' | 'double' | 'forced'
  phase?: TdpPhase
  round?: number
  turn_no?: number
}

export interface TdpPlayerStats {
  /** Passages par le Départ. */
  laps: number
  rent_paid: number
  rent_received: number
  /** Total de cagnotte ramassé sur « Pause apéro » (absent tant que rien ramassé). */
  pot?: number
  bought: number
  built: number
  jail: number
  cards: number
}

/** Loyer payé pendant le tour de table en cours (cf. TdpStateBase.round_rents). */
export interface TdpRentPayment {
  /** event_no du log 'rent' correspondant. */
  no: number
  payer: string
  owner: string
  cell: number
  amount: number
}

/** Ligne du classement final. */
export interface TdpRankingRow {
  player: string
  /** Rang (ex-aequo = même rang). */
  rank: number
  /** argent + lieux + bâtiments (0 si failli). */
  fortune: number
  cash: number
  /** Valeur des lieux possédés (prix d'achat). */
  properties: number
  /** Valeur des bâtiments (prix de construction). */
  buildings: number
  /** Nombre de cases possédées. */
  owned: number
  bankrupt: boolean
}

/** Champs communs du state (hors `phase` / `pending`, cf. TdpState). */
export interface TdpStateBase {
  game: 'tour-des-potes'
  /** Joueurs de la partie (ordre de la soirée). */
  players: string[]
  /** Ordre de jeu (tiré au sort). */
  order: string[]
  /** Joueurs encore en lice, dans l'ordre de jeu. */
  alive: string[]
  /** Faillis, dans l'ordre de faillite (spectateurs). */
  bankrupt: string[]
  format: TdpFormat
  /** Durée (format chrono), sinon null. */
  minutes: 30 | 45 | 60 | null
  /** Nombre de tours de table (format tours), sinon null. */
  total_rounds: 10 | 15 | 20 | null
  started_at: string
  /** Fin prévue (chrono) / filet 3 h (classique) ; null en format tours. */
  ends_at: string | null
  /** Chrono échu : on termine le tour en cours puis fin. */
  last_turn: boolean
  /** Secondes par décision (0 = pas de minuteur). */
  turn_seconds: 0 | 30 | 45 | 60 | 90
  /** Tour de table en cours (commence à 1). */
  round: number
  /** Numéro du tour de joueur (croissant). */
  turn_no: number
  /** Joueur au trait (null en fin de partie). */
  turn: string | null
  /** Doubles consécutifs du tour en cours (> 0 en phase roll = « rejoue »). */
  doubles: number
  /** Derniers dés lancés (null avant le premier lancer). */
  dice: [number, number] | null
  /** Argent par joueur (peut être négatif en phase debt). */
  cash: Record<string, number>
  /** Case de chaque joueur (0-39). */
  pos: Record<string, number>
  /** Propriétaires : {"<index de case>": uid}. Absent = à la banque. */
  owners: Record<string, string>
  /** Bâtiments : {"<index de case>": 1-4 maisons | 5 = hôtel}. Absent = 0. */
  buildings: Record<string, number>
  /** Joueurs au violon : {uid: essais de double déjà ratés (0-2)}. */
  jail: Record<string, number>
  /** Cartes « Sortie du violon » détenues : {uid: [id de carte]}. */
  jail_cards: Record<string, string[]>
  /** Joueurs marqués absents par l'hôte (tours joués automatiquement). */
  away: string[]
  last_event: TdpLastEvent | null
  /** Évènements produits par la DERNIÈRE action (à animer dans l'ordre). */
  events: TdpEvent[]
  /** Journal : 40 derniers évènements. */
  log: TdpEvent[]
  /** Numéro du dernier évènement. */
  event_no: number
  stats: Record<string, TdpPlayerStats>
  /**
   * Cagnotte des taxes (cases 4, 38) depuis le dernier ramassage : billets
   * empilés au centre du plateau. Le joueur qui s'arrête sur « Pause apéro »
   * (case 20) la ramasse en entier (évènement 'pot', last_event.pot) et elle
   * repart de 0. Hors fortune ; les paiements de cartes n'y vont pas. (Absent
   * dans un state antérieur à la mise à jour : lire avec ?? 0.)
   */
  tax_pot: number
  /**
   * Loyers payés pendant le tour de table en cours (round = state.round), dans
   * l'ordre, y compris ceux déclenchés par une carte ; 60 au plus. Vidé au
   * changement de tour de table. (Absent dans un state antérieur : lire avec ?.)
   */
  round_rents: { round: number; payments: TdpRentPayment[] }
  /** ISO : échéance de la décision en cours (null si pas de minuteur / fin). */
  deadline: string | null
  end_reason: TdpEndReason | null
  /** Fin : premier(s) du classement. */
  winners: string[] | null
  ranking: TdpRankingRow[] | null
  seq?: number
  aborted?: boolean
  results?: Array<{ profile_id: string; points: number; won: boolean; placement: number }> | null
  new_unlocks?: Record<string, string[]>
  new_tenues?: Record<string, string[]>
  xp_gained?: Record<string, number>
}

/**
 * State public. `pending` dépend de la phase (union discriminée par `phase`) :
 *   phase `buy`  → offre d'achat {cell, price} ;
 *   phase `card` → pioche en attente {cell, deck} (action {type:'draw'}) ;
 *   autres phases → null.
 * Tester `s.phase === 'buy'` (ou 'card') suffit à typer `s.pending`.
 */
export type TdpState = TdpStateBase &
  (
    | { phase: 'buy'; pending: TdpPendingBuy | null }
    | { phase: 'card'; pending: TdpPendingCard | null }
    | { phase: Exclude<TdpPhase, 'buy' | 'card'>; pending: null }
  )

export type TdpAction =
  | { type: 'roll' }
  | { type: 'pay_jail' }
  | { type: 'use_card' }
  /** Phase card : piocher la carte en attente. */
  | { type: 'draw' }
  | { type: 'buy' }
  | { type: 'pass' }
  | { type: 'build'; cell: number }
  | { type: 'sell'; cell: number }
  | { type: 'end_turn' }
  | { type: 'tick' }
  | { type: 'skip' }
  | { type: 'back' }

export interface TdpOptions {
  format: TdpFormat
  minutes: 30 | 45 | 60
  rounds: 10 | 15 | 20
  turn_seconds: 0 | 30 | 45 | 60 | 90
}

/** Type d'une case (ré-export pratique). */
export type { CellType }
