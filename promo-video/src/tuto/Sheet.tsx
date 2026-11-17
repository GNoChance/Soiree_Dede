// Planche de contrôle (outil de dev) : les étapes d'un tuto côte à côte, figées à la même
// fraction de leur durée. `npx remotion still src/index.ts Sheet-<id> out/x.png --frame=85 --scale=0.5`
// → frame 0..100 = pourcentage d'avancement de chaque étape.
import React from 'react'
import { useCurrentFrame } from 'remotion'
import { TH, TW, TutoBackground, sec } from './kit'
import { TUTOS } from './registry'
import { StepScene } from './scenes'

export const Sheet: React.FC<{ id: string }> = ({ id }) => {
  const pct = useCurrentFrame() / 100
  const spec = TUTOS.find((t) => t.id === id)
  if (!spec) throw new Error(`Tuto inconnu : ${id}`)
  return (
    <>
      {spec.steps.map((step, k) => {
        const dur = sec(step.seconds)
        return (
          <div key={k} style={{ position: 'absolute', left: k * TW, top: 0, width: TW, height: TH, overflow: 'hidden' }}>
            <TutoBackground f={0} color={spec.color} />
            <StepScene f={Math.round(dur * pct)} dur={dur} spec={spec} step={step} index={k} />
          </div>
        )
      })}
    </>
  )
}
