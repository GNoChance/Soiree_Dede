// Effets sonores synthétisés (voir scripts/make-sfx.mjs → public/sfx/*.wav).
// Fichier .ts (pas .tsx) : le composant utilise createElement.
import { createElement, type FC } from 'react'
import { Audio } from '@remotion/media'
import { Sequence, staticFile } from 'remotion'
import { FPS } from './timeline'

export const SFX = {
  tap: staticFile('sfx/tap.wav'),
  whoosh: staticFile('sfx/whoosh.wav'),
  pop: staticFile('sfx/pop.wav'),
  'swoosh-up': staticFile('sfx/swoosh-up.wav'),
  success: staticFile('sfx/success.wav'),
  jingle: staticFile('sfx/jingle.wav'),
  type: staticFile('sfx/type.wav'),
} as const

/** Durée réelle de chaque fichier, en secondes (doit suivre make-sfx.mjs). */
export const SFX_SECONDS: Record<SfxName, number> = {
  tap: 0.06,
  whoosh: 0.4,
  pop: 0.12,
  'swoosh-up': 0.3,
  success: 0.5,
  jingle: 1.8,
  type: 0.04,
}

export type SfxName = keyof typeof SFX

/**
 * Joue un effet sonore à partir de la frame `at` (frames à FPS = 60).
 * Le Sequence borne la durée à celle du fichier.
 */
export const Sfx: FC<{ name: SfxName; at: number; volume?: number }> = ({ name, at, volume = 1 }) =>
  createElement(
    Sequence,
    { from: at, durationInFrames: Math.ceil(SFX_SECONDS[name] * FPS) },
    createElement(Audio, { src: SFX[name], volume }),
  )
