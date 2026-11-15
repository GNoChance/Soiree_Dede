import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

interface SettingsState {
  theme: Theme
  sound: boolean
  haptics: boolean
  setTheme: (t: Theme) => void
  setSound: (v: boolean) => void
  setHaptics: (v: boolean) => void
}

/** Clef localStorage lue aussi par le script inline d'index.html (anti-flash) */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'system',
      sound: true,
      haptics: true,
      setTheme: (theme) => set({ theme }),
      setSound: (sound) => set({ sound }),
      setHaptics: (haptics) => set({ haptics }),
    }),
    {
      name: 'dede-settings',
      partialize: (s) => ({ theme: s.theme, sound: s.sound, haptics: s.haptics }),
    },
  ),
)
