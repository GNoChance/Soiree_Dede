/**
 * Logique PURE du socle duel (aucune dépendance React / Supabase) : testable
 * sous Node (`node --experimental-strip-types` / Node ≥ 23 par défaut).
 * Miroirs des règles SQL de supabase/features/duel.sql.
 */
import type {
  BracketMatch,
  DuelBracket,
  DuelEndReason,
  DuelInfo,
  DuelMode,
  DuelOptionsValue,
  DuelRole,
  DuelSession,
  DuelState,
} from './types.ts'

export const DUEL_MODES: Array<{ value: DuelMode; emoji: string; label: string; short: string; help: string }> = [
  {
    value: 'king',
    emoji: '👑',
    label: 'Roi de la table',
    short: 'Roi',
    help: 'Le gagnant reste à la table, le perdant retourne au bout de la file (nul : les deux sortent). Fin dès qu’un joueur enchaîne 3 victoires, ou quand tout le monde a joué 2 duels.',
  },
  {
    value: 'tournament',
    emoji: '🏆',
    label: 'Tournoi des grosses têtes',
    short: 'Tournoi',
    help: 'Tableau à élimination directe tiré au sort, avec la tête de chacun dans les cases. Le perdant d’un match est éliminé ; match nul : revanche, puis tirage au sort. Le vainqueur de la finale est sacré grosse tête de la soirée !',
  },
  {
    value: 'duel',
    emoji: '⚔️',
    label: 'Duel',
    short: 'Duel',
    help: 'Un seul duel entre deux joueurs choisis (ou au hasard), en une manche ou au meilleur des 3. Les autres parient.',
  },
]

export const modeInfo = (mode: DuelMode) => DUEL_MODES.find((m) => m.value === mode) ?? DUEL_MODES[0]

/** Points de session (cf. SQL _duel_end_duel). */
export const DUEL_POINTS = { win: 3, draw: 1, bet: 1 } as const
/** Fenêtre de paris après le début du duel (s). */
export const BET_WINDOW_S = 15

export const DUEL_DEFAULT_OPTIONS: DuelOptionsValue = { mode: 'king', best_of: 1, duel_players: null, board: {} }

const isMode = (m: unknown): m is DuelMode => m === 'king' || m === 'tournament' || m === 'duel'

/** Options de l'écran de lancement, normalisées. */
export function normalizeDuelOptions(o: Record<string, unknown> | null | undefined): DuelOptionsValue {
  const src = o ?? {}
  const mode = isMode(src.mode) ? src.mode : 'king'
  const dp = Array.isArray(src.duel_players) ? src.duel_players.filter((x): x is string => typeof x === 'string') : []
  return {
    mode,
    best_of: Number(src.best_of) === 3 ? 3 : 1,
    duel_players: dp.length === 2 && dp[0] !== dp[1] ? [dp[0], dp[1]] : null,
    board: src.board && typeof src.board === 'object' && !Array.isArray(src.board) ? (src.board as Record<string, unknown>) : {},
  }
}

/**
 * `p_options` de start_match. Mode duel : les joueurs choisis absents de la
 * sélection sont remplacés au hasard par le serveur (duel_players omis s'il
 * n'en reste pas exactement 2 valides). best_of n'est envoyé qu'en mode duel.
 */
export function prepareDuelOptions(o: Record<string, unknown>, playerIds: string[]): Record<string, unknown> {
  const n = normalizeDuelOptions(o)
  const out: Record<string, unknown> = { mode: n.mode, board: n.board }
  if (n.mode === 'duel') {
    out.best_of = n.best_of
    const valid = (n.duel_players ?? []).filter((id) => playerIds.includes(id))
    if (valid.length === 2) out.duel_players = valid
  }
  return out
}

export function duelRole(s: Pick<DuelState, 'duel' | 'players'>, me: string): DuelRole {
  if (s.duel?.a === me) return 'a'
  if (s.duel?.b === me) return 'b'
  return s.players.includes(me) ? 'spectator' : 'outsider'
}

export const opponentOf = (duel: Pick<DuelInfo, 'a' | 'b'>, id: string): string => (id === duel.a ? duel.b : duel.a)

export const sideOf = (duel: Pick<DuelInfo, 'a' | 'b'>, id: string | null | undefined): 'a' | 'b' | null =>
  id === duel.a ? 'a' : id === duel.b ? 'b' : null

/** Les paris sont-ils ouverts ? (miroir SQL ; `now` = horloge serveur en ms) */
export function betsOpen(s: Pick<DuelState, 'phase' | 'duel'>, now: number): boolean {
  const d = s.duel
  if (!d) return false
  if (s.phase === 'transition') return true
  if (s.phase !== 'setup' && s.phase !== 'playing') return false
  if (d.game_no !== 1) return false
  return d.moves === 0 || (!!d.bets_until && now < new Date(d.bets_until).getTime())
}

/** Chrono d'un coup : « 25s », ou « 4:07 » à partir d'une minute (pendule des échecs). */
export function fmtTurnClock(sec: number): string {
  const s = Math.max(0, Math.ceil(sec))
  return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`
}

/** Nombre de manches à gagner pour remporter le duel. */
export const winsNeeded = (bestOf: number) => Math.floor((bestOf + 1) / 2)

/** Nom d'un tour du tableau (0-based). */
export function roundName(round: number, totalRounds: number): string {
  const left = totalRounds - round
  if (left === 1) return 'Finale'
  if (left === 2) return 'Demi-finales'
  if (left === 3) return 'Quarts de finale'
  if (left === 4) return 'Huitièmes'
  return `Tour ${round + 1}`
}
export function roundNameSingular(round: number, totalRounds: number): string {
  const left = totalRounds - round
  if (left === 1) return 'Finale'
  if (left === 2) return 'Demi-finale'
  if (left === 3) return 'Quart de finale'
  if (left === 4) return 'Huitième de finale'
  return `Tour ${round + 1}`
}

/** Libellé court du duel en cours (badge de l'en-tête). */
export function duelHeadline(s: Pick<DuelState, 'session' | 'duel' | 'phase'>): string | null {
  const d = s.duel
  if (!d || s.phase === 'finished' || s.phase === 'aborted') return null
  const ses = s.session
  if (ses.mode === 'tournament' && ses.bracket && d.round != null) {
    return `🏆 ${roundNameSingular(d.round, ses.bracket.rounds.length)}${d.replay ? ' · revanche' : ''}`
  }
  if (ses.mode === 'duel') {
    return ses.best_of > 1 && d.game_no > 0 ? `⚔️ Manche ${d.game_no}/${ses.best_of}` : '⚔️ Duel'
  }
  return `👑 Duel n°${d.no}`
}

export interface RankRow {
  id: string
  points: number
  /** Rang (ex-aequo partagés), 1 = premier. */
  rank: number
  champion: boolean
}

/** Classement de session (champion d'abord, puis points). Miroir de _duel_finish. */
export function sessionRanking(session: Pick<DuelSession, 'scores' | 'champion'>, players: string[], winners?: string[] | null): RankRow[] {
  const champ = new Set(winners && winners.length ? winners : session.champion ? [session.champion] : [])
  const rows = players.map((id) => ({ id, points: session.scores[id] ?? 0, champion: champ.has(id) }))
  rows.sort((x, y) => Number(y.champion) - Number(x.champion) || y.points - x.points)
  return rows.map((r) => ({
    ...r,
    rank: 1 + rows.filter((o) => Number(o.champion) > Number(r.champion) || (o.champion === r.champion && o.points > r.points)).length,
  }))
}

/** Roi : où en est-on de la condition de fin ? */
export function kingProgress(session: Pick<DuelSession, 'stats' | 'streak' | 'streak_target' | 'min_played'>, players: string[]) {
  const played = players.map((p) => session.stats[p]?.played ?? 0)
  const minPlayed = played.length ? Math.min(...played) : 0
  return {
    minPlayed,
    everyonePlayed: minPlayed >= 1,
    waitingFirst: players.filter((p) => (session.stats[p]?.played ?? 0) === 0),
    streak: session.streak.count,
    streakTarget: session.streak_target,
    minTarget: session.min_played,
  }
}

export function endReasonLabel(r: DuelEndReason | null | undefined): string {
  switch (r) {
    case 'streak':
      return 'Trois victoires d’affilée : règne incontesté !'
    case 'rotation':
      return 'Tout le monde a eu sa chance (2 duels chacun).'
    case 'limit':
      return 'Session interminable : on s’arrête là !'
    case 'bracket':
      return 'Le tournoi a son champion.'
    case 'duel':
      return 'Le duel est joué.'
    case 'stopped':
      return 'L’hôte a sifflé la fin de la session.'
    default:
      return ''
  }
}

/** Taille du tableau (puissance de 2 ≥ n), exempts et nombre de tours. Miroir de _duel_bracket_new. */
export function bracketShape(n: number): { size: number; byes: number; rounds: number } {
  let size = 2
  while (size < n) size *= 2
  return { size, byes: Math.max(0, size - n), rounds: Math.round(Math.log2(size)) }
}

export interface PathStep {
  round: number
  /** Adversaire battu (null = exempt). */
  opponent: string | null
  bye: boolean
  /** Qualifié au tirage au sort après deux nuls. */
  random: boolean
}

/** Parcours d'un joueur dans le tableau : les tours qu'il a passés. */
export function bracketPath(bracket: DuelBracket | null | undefined, id: string): PathStep[] {
  if (!bracket) return []
  const out: PathStep[] = []
  bracket.rounds.forEach((round, r) => {
    for (const m of round) {
      if (m.winner !== id || (m.a !== id && m.b !== id)) continue
      out.push({ round: r, opponent: m.status === 'bye' ? null : m.a === id ? m.b : m.a, bye: m.status === 'bye', random: m.random })
    }
  })
  return out
}

/** Finaliste battu (tournoi terminé), ou null. */
export function runnerUp(bracket: DuelBracket | null | undefined): string | null {
  const f = bracket?.rounds[bracket.rounds.length - 1]?.[0]
  if (!f || !f.winner || f.status === 'bye') return null
  return f.winner === f.a ? f.b : f.a
}

/* ------------------------------------------------------ humeur des duellistes */

/**
 * Humeur d'un duelliste, déduite du state public (mode télé) ; `frac` = part
 * du temps de jeu restante (0..1) :
 *  - confident : annonce du duel ; set / ready : préparation ;
 *  - think / panic : à son tour (panic sous 20 % du temps) ;
 *  - proud : vient de jouer ; sleepy : l'adversaire traîne (< 35 % du temps) ;
 *  - angry : l'adversaire rejoue (touché, rejoue…) ; oops : son dernier coup était automatique ;
 *  - win / lose / draw : fin de manche ou de duel.
 */
export type FighterMood = 'confident' | 'set' | 'ready' | 'think' | 'panic' | 'proud' | 'sleepy' | 'angry' | 'oops' | 'waiting' | 'win' | 'lose' | 'draw'

export function fighterMood(s: Pick<DuelState, 'phase' | 'duel'>, id: string, frac: number): FighterMood {
  const d = s.duel
  if (!d || (id !== d.a && id !== d.b)) return 'waiting'
  switch (s.phase) {
    case 'transition':
      return 'confident'
    case 'setup':
      return d.ready.includes(id) ? 'ready' : 'set'
    case 'result': {
      const res = d.result
      if (res) {
        if (res.advanced) return res.advanced === id ? 'win' : 'lose'
        return res.draw ? 'draw' : res.winner === id ? 'win' : 'lose'
      }
      if (d.outcome === 'draw') return 'draw'
      return d.winner === id ? 'win' : d.winner ? 'lose' : 'waiting'
    }
    case 'playing': {
      const lm = d.last_move
      if (d.turn === id) return frac < 0.2 ? 'panic' : 'think'
      if (lm && lm.by === id && lm.auto) return 'oops'
      if (lm && lm.by !== id && lm.by === d.turn && d.moves > 0) return 'angry'
      if (frac < 0.35) return 'sleepy'
      if (lm && lm.by === id) return 'proud'
      return 'waiting'
    }
    default:
      return 'waiting'
  }
}

/** Expressions voulues (ordre de préférence, palette de base d'abord) et bulle de chaque humeur. */
export const FIGHTER_MOODS: Record<FighterMood, { expr: string[]; bubble: string | null; label: string | null }> = {
  confident: { expr: ['determine', 'cool', 'clin_oeil', 'joie'], bubble: '💪', label: null },
  set: { expr: ['reflexion', 'clin_oeil'], bubble: '🤫', label: 'se prépare' },
  ready: { expr: ['pouces', 'determine', 'joie'], bubble: '👍', label: 'c’est prêt' },
  think: { expr: ['reflexion', 'determine', 'clin_oeil'], bubble: '🤔', label: 'réfléchit' },
  panic: { expr: ['surprise', 'timide', 'colere'], bubble: '😱', label: 'vite !' },
  proud: { expr: ['clin_oeil', 'cool', 'pouces', 'joie'], bubble: '😏', label: null },
  sleepy: { expr: ['dodo', 'boude', 'reflexion'], bubble: '💤', label: null },
  angry: { expr: ['colere', 'boude'], bubble: '😤', label: 'grr…' },
  oops: { expr: ['timide', 'boude', 'surprise'], bubble: '🙈', label: 'trop lent !' },
  waiting: { expr: ['joie'], bubble: null, label: null },
  win: { expr: ['pouces', 'cool', 'joie'], bubble: '🎉', label: 'gagné !' },
  lose: { expr: ['pleurs', 'boude', 'colere'], bubble: '😭', label: null },
  draw: { expr: ['surprise', 'timide', 'clin_oeil'], bubble: '😮', label: 'nul !' },
}

/** Le tableau du tournoi : match du duel courant (ou null). */
export function currentMatch(s: Pick<DuelState, 'session' | 'duel'>): BracketMatch | null {
  const b = s.session.bracket
  const d = s.duel
  if (!b || !d || d.round == null || d.match == null) return null
  return b.rounds[d.round]?.[d.match] ?? null
}

/* ---------------------------------------------------------------- couleurs */

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  const r = ((n >> 16) & 255) / 255
  const g = ((n >> 8) & 255) / 255
  const b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return [h, s, l]
}

/** Deux couleurs assez différentes pour être distinguées d'un coup d'œil ? */
export function colorsDistinct(c1: string, c2: string): boolean {
  const a = hexToHsl(c1)
  const b = hexToHsl(c2)
  if (!a || !b) return c1.toLowerCase() !== c2.toLowerCase()
  const dh = Math.min(Math.abs(a[0] - b[0]), 360 - Math.abs(a[0] - b[0]))
  return dh >= 45 || Math.abs(a[2] - b[2]) >= 0.3
}

/** Fallback « sticker » quand les couleurs des persos se ressemblent. */
export const DUEL_FALLBACK_COLORS = { a: '#EF476F', b: '#FFB703' } as const

/** Couleurs des duellistes : leur couleur de perso, sinon tomate / soleil. */
export function pickSideColors(colorA: string, colorB: string): { a: string; b: string } {
  return colorsDistinct(colorA, colorB) ? { a: colorA, b: colorB } : { ...DUEL_FALLBACK_COLORS }
}
