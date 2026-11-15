import { useSyncExternalStore } from 'react'

/**
 * Galerie des dessins d'une partie, côté client uniquement : chaque client
 * capture son canvas à la fin du tour, et le dessinateur diffuse un snapshot
 * (`snapshot`) qui remplace la capture locale. Mémoire + sessionStorage (best effort).
 */
export interface GalleryItem {
  turn: number
  drawer: string
  word: string | null
  data: string
  /** Venu du dessinateur (prioritaire sur une capture locale). */
  official: boolean
}

const mem = new Map<string, GalleryItem[]>()
const subs = new Set<() => void>()
const key = (matchId: string) => `dede:dd-gallery:${matchId}`

function load(matchId: string): GalleryItem[] {
  let list = mem.get(matchId)
  if (list) return list
  list = []
  try {
    const raw = sessionStorage.getItem(key(matchId))
    if (raw) list = JSON.parse(raw) as GalleryItem[]
  } catch {
    /* ignore */
  }
  mem.set(matchId, list)
  return list
}

export function addToGallery(matchId: string, item: GalleryItem) {
  const list = load(matchId)
  const cur = list.find((g) => g.turn === item.turn)
  if (cur && (cur.official || !item.official)) {
    if (!cur.word && item.word) {
      const next = list.map((g) => (g.turn === item.turn ? { ...g, word: item.word } : g))
      save(matchId, next)
    }
    return
  }
  save(matchId, [...list.filter((g) => g.turn !== item.turn), item].sort((a, b) => a.turn - b.turn))
}

function save(matchId: string, list: GalleryItem[]) {
  mem.set(matchId, list)
  try {
    sessionStorage.setItem(key(matchId), JSON.stringify(list))
  } catch {
    /* quota : la mémoire suffit */
  }
  subs.forEach((f) => f())
}

export function hasGalleryTurn(matchId: string, turn: number, official = false): boolean {
  return load(matchId).some((g) => g.turn === turn && (!official || g.official))
}

const EMPTY: GalleryItem[] = []

export function useGallery(matchId: string | null | undefined): GalleryItem[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => (matchId ? load(matchId) : EMPTY),
  )
}

/** Dernière partie jouée sur cet appareil (le Summary ne reçoit pas le matchId). */
const LAST_KEY = 'dede:dd-gallery:last'
let lastMatchId: string | null = null
export const setLastGalleryMatch = (id: string) => {
  if (lastMatchId === id) return
  lastMatchId = id
  try {
    sessionStorage.setItem(LAST_KEY, id)
  } catch {
    /* ignore */
  }
}
export const getLastGalleryMatch = (): string | null => {
  if (lastMatchId) return lastMatchId
  try {
    return sessionStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}
