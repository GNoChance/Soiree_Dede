import { ChibiImage } from '@/components/ui/ChibiImage'
import type { GamePlayProps } from '../types'

/** Placeholder : le vrai jeu arrive en phase 2. */
export function Play({ matchId }: GamePlayProps) {
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      <ChibiImage slug="kevin" expression="cool" size={140} />
      <h2 className="text-3xl">Undercover</h2>
      <p className="text-muted">Bientôt… (partie {matchId})</p>
    </div>
  )
}
