// Contrat de timeline partagé (frames à 60 FPS).
export const FPS = 60
export const WIDTH = 1080
export const HEIGHT = 1920
const s = (sec: number) => Math.round(sec * FPS)
export const SEQ = {
  intro: { from: 0, duration: s(7) },      // 0 → 7 s
  ios: { from: s(7), duration: s(9) },      // 7 → 16 s
  android: { from: s(16), duration: s(9) }, // 16 → 25 s
  outro: { from: s(25), duration: s(3) },   // 25 → 28 s
} as const
export const TOTAL_FRAMES = s(28)
export const APP_URL = 'soiree-dede.vercel.app'
export const APP_NAME = 'Les Soirées de Dédé'
