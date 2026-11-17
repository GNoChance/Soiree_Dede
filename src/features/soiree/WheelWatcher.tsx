import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useSession } from '@/store/session'
import { GameWheel } from './GameWheel'
import { useWheelSpins, type WheelSpin } from './hostTools'
import { useActiveSoireesStore } from './activeSoirees'

/**
 * Roue des jeux visible partout : un joueur qui n'est pas dans le salon (écran de fin
 * de partie, accueil, classements…) voit aussi la roue tourner quand l'hôte la lance.
 * Le salon de la soirée affiche déjà sa propre roue (SoireePage) : rien ici dans ce cas.
 */
export function WheelWatcher() {
  const meId = useSession((s) => s.profile?.id)
  const soirees = useActiveSoireesStore((s) => s.soirees)
  if (!meId) return null
  return (
    <>
      {soirees
        .filter((s) => s.status !== 'ended' && s.host_id !== meId)
        .map((s) => (
          <SoireeWheel key={s.id} soireeId={s.id} />
        ))}
    </>
  )
}

function SoireeWheel({ soireeId }: { soireeId: string }) {
  const navigate = useNavigate()
  const inSalon = useActiveSoireesStore((s) => s.viewing?.soireeId === soireeId && s.viewing.kind === 'salon')
  const [spin, setSpin] = useState<WheelSpin | null>(null)
  useWheelSpins(soireeId, (sp) => setSpin((cur) => (cur && cur.id >= sp.id ? cur : sp)))
  if (!spin || inSalon) return null
  return (
    <GameWheel
      spin={spin}
      isHost={false}
      busy={false}
      onLaunch={() => {}}
      onRespin={() => {}}
      onClose={() => setSpin(null)}
      onGoSalon={() => {
        setSpin(null)
        navigate(`/soiree/${soireeId}`)
      }}
    />
  )
}
