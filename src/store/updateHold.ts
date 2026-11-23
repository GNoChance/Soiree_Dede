import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * Parties en cours qui retiennent la proposition « Mettre à jour » : recharger l'appli
 * en plein défi du jour ou en plein match coupe la partie (le défi est alors clôturé).
 */
interface UpdateHoldState {
  holds: number
  add: () => void
  remove: () => void
}

export const useUpdateHold = create<UpdateHoldState>((set) => ({
  holds: 0,
  add: () => set((s) => ({ holds: s.holds + 1 })),
  remove: () => set((s) => ({ holds: Math.max(0, s.holds - 1) })),
}))

/** Tant que `active` est vrai, la mise à jour de l'appli n'est pas proposée. */
export function useHoldUpdate(active = true) {
  useEffect(() => {
    if (!active) return
    useUpdateHold.getState().add()
    return () => useUpdateHold.getState().remove()
  }, [active])
}
