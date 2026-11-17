// Helpers d'animation partagés par les scènes (frames locales à 60 FPS).
import { spring } from 'remotion'
import { FPS } from './timeline'
import type { Pt } from './devices/common'

export const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** 0 avant a, 1 après b, linéaire entre les deux. */
export const ramp = (f: number, a: number, b: number) => clamp01((f - a) / (b - a))
export const easeOut = (v: number) => 1 - Math.pow(1 - clamp01(v), 3)
export const easeIn = (v: number) => Math.pow(clamp01(v), 3)
export const easeInOut = (v: number) => {
  const x = clamp01(v)
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export type SpringCfg = { stiffness?: number; damping?: number; mass?: number }
/** Spring décalé de `delay` frames. */
export const sp = (f: number, delay = 0, config: SpringCfg = { stiffness: 170, damping: 18 }) =>
  spring({ frame: Math.max(0, f - delay), fps: FPS, config })

/** Préréglages de ressorts. */
export const SPRING = {
  smooth: { stiffness: 120, damping: 20, mass: 1 },
  snappy: { stiffness: 260, damping: 22 },
  bouncy: { stiffness: 320, damping: 11 },
  pop: { stiffness: 420, damping: 13 },
} as const

/** Transition par ressort (0→1) entre deux bornes, sans dépassement. */
export const glide = (f: number, from: number, cfg: SpringCfg = SPRING.smooth) => clamp01(sp(f, from, cfg))

// ---------------------------------------------------------------------------
// Poses de téléphone (centre en px dans le cadre 1080×1920)
// ---------------------------------------------------------------------------
export type Pose = { x: number; y: number; s: number; rx?: number; ry?: number; rz?: number; o?: number }

export const mixPose = (a: Pose, b: Pose, t: number): Pose => ({
  x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), s: lerp(a.s, b.s, t),
  rx: lerp(a.rx ?? 0, b.rx ?? 0, t), ry: lerp(a.ry ?? 0, b.ry ?? 0, t), rz: lerp(a.rz ?? 0, b.rz ?? 0, t),
  o: lerp(a.o ?? 1, b.o ?? 1, t),
})

/** Flou de mouvement simulé : proportionnel à la vitesse (px/frame) de la pose. */
export const motionBlur = (poseAt: (f: number) => Pose, f: number, k = 0.09, max = 8) => {
  const a = poseAt(f - 1)
  const b = poseAt(f)
  const v = Math.hypot(b.x - a.x, b.y - a.y) + Math.abs(b.s - a.s) * 900 + Math.abs((b.ry ?? 0) - (a.ry ?? 0)) * 6
  return Math.min(max, Math.max(0, v * k - 0.6))
}

// Poses de référence
export const POSE = {
  introIphone: { x: 282, y: 1010, s: 0.97, rx: 4, ry: 13, rz: -1.5 } as Pose,
  introGalaxy: { x: 800, y: 1010, s: 0.99, rx: 4, ry: -13, rz: 1.5 } as Pose,
  tutoIphone: { x: 540, y: 1012, s: 1.36 } as Pose,
  tutoGalaxy: { x: 540, y: 1012, s: 1.42 } as Pose,
  outroIphone: { x: 318, y: 700, s: 0.62, ry: 10, rz: -3 } as Pose,
  outroGalaxy: { x: 762, y: 700, s: 0.64, ry: -10, rz: 3 } as Pose,
}

// ---------------------------------------------------------------------------
// Doigt virtuel
// ---------------------------------------------------------------------------
export type Tap = { at: number; pt: Pt }

/** Position / visibilité / appui du doigt pour une liste de taps triés. */
export const fingerAt = (f: number, taps: Tap[]) => {
  let visible = 0
  for (const t of taps) visible = Math.max(visible, ramp(f, t.at - 36, t.at - 22) * (1 - ramp(f, t.at + 20, t.at + 34)))
  let k = taps.findIndex((t) => f < t.at + 22)
  if (k === -1) k = taps.length - 1
  const cur = taps[k]
  const prev = k > 0 && cur.at - taps[k - 1].at < 90 ? taps[k - 1].pt : { x: cur.pt.x + 60, y: cur.pt.y + 110 }
  const m = easeInOut(ramp(f, cur.at - 26, cur.at - 3))
  const press = f >= cur.at && f < cur.at + 22 ? (f - cur.at) / 22 : 0
  return { x: lerp(prev.x, cur.pt.x, m), y: lerp(prev.y, cur.pt.y, m), visible, press }
}

/** Enfoncement 0→1→0 sur `len` frames à partir de `at`. */
export const pressPulse = (f: number, at: number, len = 14) => (f >= at && f < at + len ? Math.sin(((f - at) / len) * Math.PI) : 0)

// ---------------------------------------------------------------------------
// Saisie
// ---------------------------------------------------------------------------
export const typedCount = (f: number, text: string, from: number, perChar: number) =>
  Math.max(0, Math.min(text.length, Math.floor((f - from) / perChar) + 1))
export const typed = (f: number, text: string, from: number, perChar = 2.5) =>
  f < from ? '' : text.slice(0, typedCount(f, text, from, perChar))
