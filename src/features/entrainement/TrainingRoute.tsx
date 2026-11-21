import { lazy, Suspense } from 'react'

const TrainingPage = lazy(() => import('./TrainingPage'))

/** Route /entrainement/:gameId (Mini-golf, Bowling, Dédé Kart seul), chargée à la demande. */
export function TrainingRoute() {
  return (
    <Suspense fallback={null}>
      <TrainingPage />
    </Suspense>
  )
}
