/**
 * Revanche : mémorise, par partie lancée depuis le salon, les réglages de l'hôte
 * (jeu, options brutes de l'écran de lancement, joueurs) pour relancer le même jeu
 * en un bouton. Purement côté navigateur de l'hôte (localStorage, 12 dernières parties).
 * Les options sont les options BRUTES du lanceur : `prepareStart` du jeu est rejoué à la
 * revanche, donc les questions / cartes / mots sont retirés à neuf.
 */
const KEY = 'dede:rematch'
const MAX = 12

export interface LaunchMemo {
  gameId: string
  options: Record<string, unknown>
  /** Joueurs retenus au lancement (hors animateur exclu). */
  playerIds: string[]
}

type Store = Record<string, LaunchMemo>

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Store) : {}
  } catch {
    return {}
  }
}

export function saveLaunch(matchId: string, memo: LaunchMemo): void {
  try {
    const store = read()
    delete store[matchId]
    store[matchId] = memo
    const keys = Object.keys(store)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX))) delete store[k]
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* ignore : sans mémoire, la revanche ouvre le lanceur pré-rempli */
  }
}

export function loadLaunch(matchId: string): LaunchMemo | null {
  const m = read()[matchId]
  return m && typeof m.gameId === 'string' && Array.isArray(m.playerIds) ? { gameId: m.gameId, options: m.options ?? {}, playerIds: m.playerIds } : null
}

/** Pré-remplissage du lanceur (state de navigation vers /soiree/:id). */
export interface LauncherPreset {
  gameId: string
  options?: Record<string, unknown>
}
