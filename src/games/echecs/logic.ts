/**
 * Logique PURE d'affichage des échecs (aucune règle : les coups légaux viennent
 * du serveur, `board.moves`). Index 0 = a8 … 63 = h1.
 */
import type { Cadence, ChessBoard, ChessEndReason, ChessSide, Promo } from './types'

export const FILES = 'abcdefgh'

export const rowOf = (i: number) => Math.floor(i / 8)
export const colOf = (i: number) => i % 8
/** « e4 » */
export const squareName = (i: number) => `${FILES[colOf(i)]}${8 - rowOf(i)}`
export const isDarkSquare = (i: number) => (rowOf(i) + colOf(i)) % 2 === 1

export const pieceAt = (sq: string, i: number): string | null => (sq[i] && sq[i] !== '.' ? sq[i] : null)
export const sideOfPiece = (p: string): ChessSide => (p === p.toUpperCase() ? 'w' : 'b')
export const sideOfPlayer = (b: Pick<ChessBoard, 'white' | 'black'>, id: string): ChessSide | null =>
  id === b.white ? 'w' : id === b.black ? 'b' : null
export const playerOfSide = (b: Pick<ChessBoard, 'white' | 'black'>, s: ChessSide) => (s === 'w' ? b.white : b.black)
export const otherSide = (s: ChessSide): ChessSide => (s === 'w' ? 'b' : 'w')

/** Chaque duelliste voit ses pièces en bas ; spectateurs et télé : Blancs en bas. */
export const isFlipped = (b: Pick<ChessBoard, 'black'>, me: string, spectator: boolean) => !spectator && me === b.black

/** Ordre d'affichage des 64 cases (de haut en bas, de gauche à droite). */
export function displayOrder(flipped: boolean): number[] {
  const out = Array.from({ length: 64 }, (_, i) => i)
  return flipped ? out.reverse() : out
}

/** Cases d'arrivée légales depuis `from`. */
export const targetsOf = (b: Pick<ChessBoard, 'moves'>, from: number | null): number[] =>
  from == null ? [] : (b.moves[String(from)] ?? []).map(Number)

/** Le coup from -> to est une promotion (pion qui arrive sur la dernière rangée). */
export function isPromotion(sq: string, from: number, to: number): boolean {
  const p = sq[from]
  return (p === 'P' || p === 'p') && (rowOf(to) === 0 || rowOf(to) === 7)
}

export const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }

/** Matériel (pion 1, cavalier 3, fou 3, tour 5, dame 9) d'un camp sur l'échiquier. */
export function material(sq: string, side: ChessSide): number {
  let n = 0
  for (const ch of sq) {
    if (ch === '.' || sideOfPiece(ch) !== side) continue
    n += PIECE_VALUE[ch.toLowerCase()] ?? 0
  }
  return n
}

/** Pièces prises triées par valeur décroissante (pour l'affichage sous chaque joueur). */
export const sortCaptured = (s: string) =>
  [...s].sort((a, b) => (PIECE_VALUE[b.toLowerCase()] ?? 0) - (PIECE_VALUE[a.toLowerCase()] ?? 0))

export const kingIndex = (sq: string, side: ChessSide) => sq.indexOf(side === 'w' ? 'K' : 'k')

/** Décalage (en cases d'affichage) d'un déplacement from -> to, pour l'animation de glissement. */
export function slideDelta(from: number, to: number, flipped: boolean) {
  const k = flipped ? -1 : 1
  return { dx: (colOf(from) - colOf(to)) * k, dy: (rowOf(from) - rowOf(to)) * k }
}

export const PROMOS: Array<{ id: Promo; label: string }> = [
  { id: 'q', label: 'Dame' },
  { id: 'r', label: 'Tour' },
  { id: 'b', label: 'Fou' },
  { id: 'n', label: 'Cavalier' },
]

export const END_LABELS: Record<ChessEndReason, { title: string; emoji: string }> = {
  mate: { title: 'Échec et mat !', emoji: '👑' },
  stalemate: { title: 'Pat : match nul', emoji: '🤷' },
  repetition: { title: '3 fois la même position : nul', emoji: '🔁' },
  fifty: { title: '50 coups sans prise : nul', emoji: '🐌' },
  material: { title: 'Plus assez de pièces pour mater : nul', emoji: '🪶' },
  time: { title: 'Temps écoulé', emoji: '⏰' },
  resign: { title: 'Abandon', emoji: '🏳️' },
  agreement: { title: 'Nul d’un commun accord', emoji: '🤝' },
}

export function endLabel(end: ChessBoard['end']): string {
  if (!end) return ''
  if (end.reason === 'time' && !end.winner) return 'Temps écoulé, mais plus de quoi mater : nul'
  return END_LABELS[end.reason].title
}

export interface CadenceInfo {
  id: Cadence
  emoji: string
  label: string
  short: string
  help: string
  /** Durée typique d'une manche (min), pour l'estimation affichée à l'hôte. */
  typical: number
}

export const CADENCES: CadenceInfo[] = [
  { id: 'blitz3', emoji: '⚡', label: 'Éclair', short: '3 min chacun', help: 'Pendule de 3 minutes par joueur : temps écoulé = partie perdue. Manche de 6 min maximum.', typical: 5 },
  { id: 'rapid5', emoji: '⏱️', label: 'Rapide', short: '5 min chacun', help: 'Pendule de 5 minutes par joueur : temps écoulé = partie perdue. Manche de 10 min maximum.', typical: 8 },
  { id: 'slow10', emoji: '🐢', label: 'Tranquille', short: '10 min chacun', help: 'Pendule de 10 minutes par joueur : temps écoulé = partie perdue. Manche de 20 min maximum.', typical: 15 },
  { id: 'none', emoji: '🧸', label: 'Sans pendule', short: '60 s par coup', help: '60 secondes par coup, sans limite de partie. Si le temps file, Dédé joue un coup au hasard pour toi !', typical: 20 },
]

const isCadence = (c: unknown): c is Cadence => c === 'blitz3' || c === 'rapid5' || c === 'slow10' || c === 'none'
export const cadenceOf = (o: Record<string, unknown> | null | undefined): Cadence => (isCadence(o?.cadence) ? o.cadence : 'rapid5')
export const cadenceInfo = (c: Cadence) => CADENCES.find((x) => x.id === c) ?? CADENCES[1]

/** « environ 25 min » */
export function aboutMinutes(min: number): string {
  if (min < 60) return `environ ${Math.max(5, Math.round(min / 5) * 5)} min`
  const h = Math.floor(min / 60)
  const m = Math.round((min % 60) / 15) * 15
  return `environ ${h} h${m ? String(m).padStart(2, '0') : ''}`
}

/** Pendule « 4:07 » (dixièmes sous 10 s : « 7.4 »). */
export function fmtClock(ms: number): string {
  const v = Math.max(0, ms)
  if (v < 10000) return (Math.floor(v / 100) / 10).toFixed(1)
  const s = Math.ceil(v / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
