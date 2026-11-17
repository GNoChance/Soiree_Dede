// Composition principale : fond continu + 4 séquences enchaînées (les poses des téléphones se raccordent d'une scène à l'autre).
import React from 'react'
import { AbsoluteFill, Sequence } from 'remotion'
import { SEQ } from './timeline'
import { Background } from './scenes/Background'
import { Intro } from './scenes/Intro'
import { IosTutorial } from './scenes/IosTutorial'
import { AndroidTutorial } from './scenes/AndroidTutorial'
import { Outro } from './scenes/Outro'

export const Promo: React.FC = () => (
  <AbsoluteFill>
    <Background />
    <Sequence from={SEQ.intro.from} durationInFrames={SEQ.intro.duration} name="Intro"><Intro /></Sequence>
    <Sequence from={SEQ.ios.from} durationInFrames={SEQ.ios.duration} name="iOS · Safari"><IosTutorial /></Sequence>
    <Sequence from={SEQ.android.from} durationInFrames={SEQ.android.duration} name="Android · Chrome"><AndroidTutorial /></Sequence>
    <Sequence from={SEQ.outro.from} durationInFrames={SEQ.outro.duration} name="Outro"><Outro /></Sequence>
  </AbsoluteFill>
)
