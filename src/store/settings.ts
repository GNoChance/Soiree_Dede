import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

interface SettingsState {
  theme: Theme
  sound: boolean
  haptics: boolean
  /** Décor de Noël (flocons, guirlande) pendant la saison. */
  noelDecor: boolean
  setTheme: (t: Theme) => void
  setSound: (v: boolean) => void
  setHaptics: (v: boolean) => void
  setNoelDecor: (v: boolean) => void
}

/** Clef localStorage lue aussi par le script inline d'index.html (anti-flash) */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      sound: true,
      haptics: true,
      noelDecor: true,
      setTheme: (theme) => set({ theme }),
      setSound: (sound) => set({ sound }),
      setHaptics: (haptics) => set({ haptics }),
      setNoelDecor: (noelDecor) => set({ noelDecor }),
    }),
    {
      name: 'dede-settings',
      partialize: (s) => ({ theme: s.theme, sound: s.sound, haptics: s.haptics, noelDecor: s.noelDecor }),
    },
  ),
)
