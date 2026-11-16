/** Textes et petits helpers d'affichage du Tour des Potes (purs, sans React). */
import { BOARD, CITIES, DECK_NAMES, type BoardCell } from './board'
import { PHASE_LABELS, buildBlocker, levelOf, pendingBuy, pendingCard, sellBlocker } from './rules'
import type { TdpCardDrawn, TdpEvent, TdpState } from './types'

export const eur = (n: number) => `${n.toLocaleString('fr-FR')} €`
export const signedEur = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('fr-FR')} €`

/** Lieu où l'on s'arrête « pour de vrai » : donne droit à la carte d'anecdote partagée. */
export const isPlace = (c: BoardCell) => c.type === 'quartier' || c.type === 'potes' || c.type === 'service'

export const cityName = (c: BoardCell) => (c.city ? CITIES[c.city].name : null)

export const CELL_KIND_LABEL: Record<BoardCell['type'], string> = {
  depart: 'Case Départ',
  quartier: 'Lieu',
  potes: 'Maison des potes',
  service: 'Service',
  taxe: 'Taxe',
  hasard: 'Carte Hasard',
  entre_potes: 'Carte Entre potes',
  violon: 'En visite / Au violon',
  apero: 'Pause apéro',
  direction_violon: 'Direction le violon',
}

/** Explication des cases sans fiche économique. */
export const CELL_RULE: Partial<Record<BoardCell['type'], string>> = {
  depart: 'Chaque passage par le Départ rapporte 200 €.',
  hasard: 'Tire une carte Hasard : bonne ou mauvaise surprise !',
  entre_potes: 'Tire une carte Entre potes : ça se passe entre amis.',
  violon: 'Simple visite si tu ne fais que passer. Sinon, c’est le violon : paie 50 €, utilise une carte, ou tente un double.',
  apero: 'Rien à payer, rien à gagner : profite de l’apéro.',
  direction_violon: 'Va directement au violon, sans passer par le Départ.',
}

export const BLOCKER_TEXT: Record<string, string> = {
  not_buildable: 'On ne construit pas ici.',
  not_owner: 'Ce lieu ne t’appartient pas.',
  group_incomplete: 'Il te faut tout le quartier pour construire.',
  max_buildings: 'Déjà un hôtel : c’est le maximum.',
  build_uneven: 'Construis d’abord sur les autres lieux du quartier.',
  no_buildings: 'Pas de bâtiment à vendre ici.',
  sell_uneven: 'Vends d’abord les bâtiments des autres lieux du quartier.',
}

/** Bâtiments en lettres : « 2 maisons », « un hôtel ». */
export const levelLabel = (lvl: number) => (lvl >= 5 ? 'un hôtel' : lvl === 0 ? 'aucun bâtiment' : `${lvl} maison${lvl > 1 ? 's' : ''}`)

const JAIL_REASON: Record<string, string> = {
  triple: 'a fait 3 doubles de suite : direction le violon !',
  case: 'va directement au violon !',
  card: 'est envoyé·e au violon par une carte !',
}

/** Ligne de journal lisible (null = évènement sans intérêt à afficher). */
export function logLine(e: TdpEvent, name: (id: string | null | undefined) => string): { icon: string; text: string } | null {
  const who = name(e.player)
  const cell = e.cell !== undefined ? (BOARD[e.cell]?.name ?? '') : ''
  switch (e.kind) {
    case 'turn':
      return { icon: '▶️', text: `Tour de ${who}${e.round ? ` (tour ${e.round})` : ''}` }
    case 'roll':
      return { icon: '🎲', text: `${who} fait ${e.dice?.[0]} + ${e.dice?.[1]}${e.double ? ' (double !)' : ''} → ${cell}` }
    case 'pass_go':
      return { icon: '🏁', text: `${who} passe par le Départ : +${eur(e.amount ?? 200)}` }
    case 'move':
      return { icon: '🚶', text: `${who} avance jusqu’à ${cell}` }
    case 'rent':
      return { icon: '💸', text: `${who} paie ${eur(e.amount ?? 0)} de loyer à ${name(e.to)} (${cell})` }
    case 'tax':
      return { icon: '🧾', text: `${who} paie ${eur(e.amount ?? 0)} : ${cell}` }
    case 'pot':
      return { icon: '🍹', text: `${who} ramasse la cagnotte de l’apéro : +${eur(e.amount ?? 0)}` }
    case 'card':
      return { icon: e.deck === 'potes' ? '🍻' : '❓', text: `${who} tire « ${e.deck ? DECK_NAMES[e.deck] : 'carte'} » : ${e.text ?? ''}` }
    case 'jail':
      return { icon: '🚔', text: `${who} ${JAIL_REASON[e.reason ?? 'case'] ?? 'va au violon !'}` }
    case 'jail_stay':
      return { icon: '🚔', text: `${who} rate son double et reste au violon` }
    case 'jail_out': {
      const how =
        e.how === 'pay' ? `paie ${eur(e.amount ?? 50)}` : e.how === 'card' ? 'utilise sa carte' : e.how === 'double' ? 'fait un double' : `paie ${eur(e.amount ?? 50)} (3e échec)`
      return { icon: '🔓', text: `${who} sort du violon : ${how}` }
    }
    case 'buy':
      return { icon: '🏠', text: `${who} achète ${cell} pour ${eur(e.amount ?? 0)}` }
    case 'pass_buy':
      return { icon: '🙅', text: `${who} ne prend pas ${cell}` }
    case 'build':
      return { icon: '🔨', text: `${who} construit ${e.level === 5 ? 'un hôtel' : 'une maison'} sur ${cell} (${eur(e.amount ?? 0)})` }
    case 'sell':
      return { icon: '🏚️', text: `${who} vend un bâtiment sur ${cell} (+${eur(e.amount ?? 0)})` }
    case 'debt':
      return { icon: '😬', text: `${who} doit ${eur(e.amount ?? 0)} : il faut vendre !` }
    case 'bankrupt':
      return { icon: '💥', text: `${who} fait faillite !` }
    case 'auto':
      return { icon: '⏱️', text: `Temps écoulé : ${who} joue automatiquement` }
    case 'away':
      return { icon: '💤', text: `${who} est absent·e : son tour est joué automatiquement` }
    case 'back':
      return { icon: '👋', text: `${who} est de retour` }
    case 'finish':
      return { icon: '🏆', text: 'Fin de la partie' }
    default:
      return null
  }
}

/** Texte court « ce qui se passe » affiché au centre du plateau. */
export function nowLine(s: TdpState, name: (id: string | null | undefined) => string, meId: string): string {
  if (s.phase === 'finished' || s.phase === 'aborted') return PHASE_LABELS[s.phase]
  const me = s.turn === meId
  const who = me ? 'Toi' : name(s.turn)
  switch (s.phase) {
    case 'roll':
      return s.doubles > 0 ? `${who} rejoue (double !)` : me ? 'À toi de lancer !' : `${who} va lancer les dés`
    case 'jail':
      return me ? 'Tu es au violon' : `${who} est au violon`
    case 'card': {
      const pc = pendingCard(s)
      const deck = pc ? `« ${DECK_NAMES[pc.deck]} »` : 'une carte'
      return me ? `Pioche une carte ${deck} !` : `${who} pioche une carte ${deck}`
    }
    case 'buy': {
      const pb = pendingBuy(s)
      return pb ? `${who} : acheter ${BOARD[pb.cell].name} (${eur(pb.price)}) ?` : PHASE_LABELS.buy
    }
    case 'manage':
      return me ? 'Construis ou finis ton tour' : `${who} gère ses biens`
    case 'debt':
      return me ? 'Dette : vends des bâtiments' : `${who} doit vendre pour payer`
    default:
      return PHASE_LABELS[s.phase]
  }
}

/** Bâtiments sous forme d'emojis (accessibilité / listes). */
export const buildingsEmoji = (s: Pick<TdpState, 'buildings'>, cell: number) => {
  const l = levelOf(s, cell)
  return l >= 5 ? '🏨' : '🏠'.repeat(l)
}

/** Pourquoi on ne peut pas construire / vendre maintenant (null = on peut). */
export function whyNotBuild(s: TdpState, me: string, cell: number): string | null {
  const b = buildBlocker(s, me, cell)
  if (b) return BLOCKER_TEXT[b] ?? 'Impossible pour l’instant.'
  if (s.turn !== me || !['roll', 'jail', 'manage'].includes(s.phase)) return 'Tu construis pendant ton tour, avant de le finir.'
  if ((s.cash[me] ?? 0) < (BOARD[cell].house ?? 0)) return 'Pas assez d’argent.'
  return null
}

export function whyNotSell(s: TdpState, me: string, cell: number): string | null {
  const b = sellBlocker(s, me, cell)
  if (b) return BLOCKER_TEXT[b] ?? 'Impossible pour l’instant.'
  if (s.turn !== me || !['roll', 'jail', 'manage', 'debt'].includes(s.phase)) return 'Tu vends pendant ton tour.'
  return null
}


/** Clé de la carte piochée du dernier évènement (null si aucune) : `last_event.no` ne change pas à la pioche. */
export const cardKeyOf = (s: Pick<TdpState, 'last_event'>): string | null => (s.last_event?.card ? `${s.last_event.no}:${s.last_event.card.id}` : null)

/** Signe du montant d'une carte (gain +1 / paiement −1) ; absent = pas de montant à afficher. */
export const CARD_AMOUNT_SIGN: Partial<Record<TdpCardDrawn['kind'], 1 | -1>> = { gain: 1, collect_each: 1, friend_gain: 1, pay: -1, pay_each: -1, repairs: -1, friend_pay: -1 }
