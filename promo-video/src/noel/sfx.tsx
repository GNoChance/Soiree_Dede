// Bruitages de la vidéo de Noël : anciens fichiers + nouveaux (scripts/make-sfx.mjs). Durées en secondes = celles des .wav.
import React from 'react'
import { Sequence, staticFile } from 'remotion'
import { Audio } from '@remotion/media'

const FILES = {
  tap: ['tap.wav', 0.06],
  whoosh: ['whoosh.wav', 0.4],
  pop: ['pop.wav', 0.12],
  'swoosh-up': ['swoosh-up.wav', 0.3],
  success: ['success.wav', 0.5],
  jingle: ['jingle.wav', 1.8],
  'wind-rise': ['wind-rise.wav', 1.5],
  gust: ['gust.wav', 1.5],
  crack1: ['crack1.wav', 0.38],
  crack2: ['crack2.wav', 0.46],
  crack3: ['crack3.wav', 0.9],
  shatter: ['shatter.wav', 1.4],
  stamp: ['stamp.wav', 0.3],
  knock: ['knock.wav', 0.2],
  skid: ['skid.wav', 0.9],
  boom: ['boom.wav', 1.0],
  hum: ['freeze-hum.wav', 2.4],
  sleigh: ['sleigh.wav', 1.4],
  rip: ['rip.wav', 0.3],
  riser: ['riser.wav', 0.5],
  type: ['type.wav', 0.04],
} as const
export type SfxName = keyof typeof FILES

/** Effet sonore joué à l'image `at` (de la séquence parente). */
export const Sfx: React.FC<{ name: SfxName; at: number; volume?: number }> = ({ name, at, volume = 0.5 }) => (
  <Sequence from={Math.max(0, Math.round(at))} durationInFrames={Math.ceil(FILES[name][1] * 30) + 1} layout="none">
    <Audio src={staticFile(`sfx/${FILES[name][0]}`)} volume={volume} />
  </Sequence>
)
