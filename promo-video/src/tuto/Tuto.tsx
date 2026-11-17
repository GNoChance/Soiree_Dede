// Gabarit d'une vidéo « Comment on joue ? » : titre → but → étapes → (scène sur-mesure) → victoire → « À vous de jouer ! ».
import React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { TutoBackground, sec } from './kit'
import { TUTOS } from './registry'
import { GoalScene, OutroScene, StepScene, TitleScene, WinScene } from './scenes'
import type { TutoSpec } from './types'

const TITLE = sec(3)
const GOAL = sec(3.6)
const WIN = sec(4.2)
const OUTRO = sec(3)

type Part = { name: string; dur: number; render: (f: number, dur: number) => React.ReactNode }

const parts = (spec: TutoSpec): Part[] => [
  { name: 'Titre', dur: TITLE, render: (f, dur) => <TitleScene f={f} dur={dur} spec={spec} /> },
  { name: 'But', dur: GOAL, render: (f, dur) => <GoalScene f={f} dur={dur} spec={spec} /> },
  ...spec.steps.map((step, index): Part => ({
    name: `Étape ${index + 1}`, dur: sec(step.seconds), render: (f, dur) => <StepScene f={f} dur={dur} spec={spec} step={step} index={index} />,
  })),
  ...(spec.extra ? [{ name: 'Sur-mesure', dur: sec(spec.extra.seconds), render: (f: number, dur: number) => React.createElement(spec.extra!.Scene, { f, dur }) }] : []),
  { name: 'Victoire', dur: WIN, render: (f, dur) => <WinScene f={f} dur={dur} spec={spec} /> },
  { name: 'Final', dur: OUTRO, render: (f) => <OutroScene f={f} spec={spec} /> },
]

export const tutoDuration = (spec: TutoSpec) => parts(spec).reduce((n, p) => n + p.dur, 0)

const Local: React.FC<{ part: Part }> = ({ part }) => <>{part.render(useCurrentFrame(), part.dur)}</>

/** Les props restent sérialisables (juste l'id) : le script complet est lu dans le registre. */
export const Tuto: React.FC<{ id: string }> = ({ id }) => {
  const f = useCurrentFrame()
  const spec = TUTOS.find((t) => t.id === id)
  if (!spec) throw new Error(`Tuto inconnu : ${id}`)
  let from = 0
  return (
    <AbsoluteFill>
      <TutoBackground f={f} color={spec.color} />
      {parts(spec).map((part) => {
        const seq = (
          <Sequence key={part.name} from={from} durationInFrames={part.dur} name={part.name}>
            <Local part={part} />
          </Sequence>
        )
        from += part.dur
        return seq
      })}
    </AbsoluteFill>
  )
}
