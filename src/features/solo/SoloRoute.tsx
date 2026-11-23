import { lazy, Suspense } from 'react'
import { useParams } from 'react-router'
import { useHoldUpdate } from '@/store/updateHold'
import { KEMS_SOLO_ID } from './kems/ids'

const SoloPage = lazy(() => import('./SoloPage'))
const KemsSoloPage = lazy(() => import('./kems/KemsSoloPage'))

/** Route /solo/:gameId (jouer seul contre un bot), chargée à la demande. Kems a son propre écran (4 joueurs). */
export function SoloRoute() {
  const { gameId } = useParams()
  useHoldUpdate()
  return <Suspense fallback={null}>{gameId === KEMS_SOLO_ID ? <KemsSoloPage /> : <SoloPage />}</Suspense>
}
