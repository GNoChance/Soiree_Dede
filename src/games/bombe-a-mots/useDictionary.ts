import { useEffect, useState } from 'react'
import type { DictStatus } from './setup'

/**
 * Chargement en arrière-plan du dictionnaire (module ./dictionary importé à la
 * demande : le gros fichier n'entre jamais dans le bundle principal).
 * - `ready` : Set chargé et non vide -> vérification locale des mots ;
 * - `off`   : échec ou dictionnaire vide -> pas de vérification (le serveur vérifie le reste) ;
 * - `loading`.
 */
let cache: Set<string> | null = null
let failed = false
let promise: Promise<Set<string> | null> | null = null

export function preloadDictionary(): Promise<Set<string> | null> {
  if (!promise) {
    promise = import('./dictionary')
      .then((m) => m.loadDictionary())
      .then((set) => {
        cache = set
        return set
      })
      .catch((e: unknown) => {
        console.warn('[bombe-a-mots] dictionnaire indisponible', e)
        failed = true
        promise = null // nouvel essai possible plus tard
        return null
      })
  }
  return promise
}

function currentStatus(): DictStatus {
  if (cache) return cache.size > 0 ? 'ready' : 'off'
  return failed ? 'off' : 'loading'
}

export function useDictionary(): { status: DictStatus; size: number; has: (w: string) => boolean } {
  const [, force] = useState(0)
  useEffect(() => {
    if (cache) return
    let alive = true
    void preloadDictionary().then(() => {
      if (alive) force((n) => n + 1)
    })
    return () => {
      alive = false
    }
  }, [])
  const set = cache
  return { status: currentStatus(), size: set?.size ?? 0, has: (w: string) => !!set?.has(w) }
}
