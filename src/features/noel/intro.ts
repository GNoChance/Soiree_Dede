import { create } from 'zustand'

/** Vidéo d'annonce de Noël : ouverture forcée (« Revoir la vidéo ») ou automatique (NoelIntroVideo). */
export const useNoelIntro = create<{ open: boolean; replay: () => void; close: () => void }>((set) => ({
  open: false,
  replay: () => set({ open: true }),
  close: () => set({ open: false }),
}))

/** Clé localStorage « vidéo déjà vue » (par édition et par profil). */
export const introSeenKey = (key: string, profileId: string) => `noel-intro:${key}:${profileId}`

export function introSeen(key: string, profileId: string): boolean {
  try {
    return window.localStorage.getItem(introSeenKey(key, profileId)) === '1'
  } catch {
    return true // stockage indisponible : on ne force pas la vidéo à chaque ouverture
  }
}

export function markIntroSeen(key: string, profileId: string) {
  try {
    window.localStorage.setItem(introSeenKey(key, profileId), '1')
  } catch {
    /* stockage indisponible */
  }
}
