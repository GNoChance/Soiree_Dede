import { lazy, Suspense } from 'react'

const SoloPage = lazy(() => import('./SoloPage'))

/** Route /solo/:gameId (jouer seul contre un bot), chargée à la demande. */
export function SoloRoute() {
  return (
    <Suspense fallback={null}>
      <SoloPage />
    </Suspense>
  )
}
