import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { burst } from '@/components/ui/confetti'
import { getSeason } from '@/data/saisons'
import { toastError } from '@/features/soiree/errors'
import { fx } from '@/lib/feedback'
import { toast } from '@/store/toast'
import { equipItem } from './api'
import { ItemPreview } from './ItemPreview'
import { markEndedSeen, useSeasonStore, type SeasonCelebration } from './season'

/** Modales de saison, une par une : palier à cosmétique / titre du passe, résumé de fin de saison. */
export function SeasonCelebrations() {
  const current = useSeasonStore((s) => s.queue[0])
  const shift = useSeasonStore((s) => s.shift)
  useEffect(() => {
    if (current) {
      fx.fanfare()
      burst()
    }
  }, [current])
  const close = () => {
    if (current?.kind === 'ended') markEndedSeen(current.ended.season_key)
    shift()
  }
  return (
    <Modal open={Boolean(current)} onClose={close} title={current ? titleOf(current) : ''}>
      {current?.kind === 'tier' && <TierBody c={current} onClose={close} />}
      {current?.kind === 'ended' && <EndedBody c={current} onClose={close} />}
    </Modal>
  )
}

function titleOf(c: SeasonCelebration) {
  if (c.kind === 'ended') {
    const s = getSeason(c.ended.season)
    return `${s?.emoji ?? '🎉'} La saison ${s?.de ?? ''} est finie !`
  }
  const s = getSeason(c.season)
  return c.tier === 20 ? `🏆 Passe ${s?.de ?? ''} terminé !` : `⭐ Palier ${c.tier} : cadeau !`
}

function TierBody({ c, onClose }: { c: Extract<SeasonCelebration, { kind: 'tier' }>; onClose: () => void }) {
  const it = c.item
  const equip = async () => {
    if (!it) return
    try {
      await equipItem(it.slot, it.id)
      fx.pop()
      toast.success(`${it.emoji} ${it.label} équipé !`)
      onClose()
    } catch (e) {
      toastError(e)
    }
  }
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      {it && (
        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 10 }}>
          <ItemPreview it={it} size={96} />
        </motion.div>
      )}
      <p className="font-bold">
        {c.tier === 20
          ? `Tu décroches le titre « ${it?.label ?? ''} » et ${c.coins} 🪙. La classe.`
          : `${it?.label ?? 'Un cadeau'} rejoint ta collection. Exclu du passe, introuvable en boutique !`}
      </p>
      {it && (
        <Button fullWidth onClick={() => void equip()}>
          L’équiper
        </Button>
      )}
      <Button variant="ghost" fullWidth onClick={onClose}>
        Plus tard
      </Button>
    </div>
  )
}

function EndedBody({ c, onClose }: { c: Extract<SeasonCelebration, { kind: 'ended' }>; onClose: () => void }) {
  const e = c.ended
  const comment = e.tier >= 20 ? 'Passe terminé. Respect éternel.' : e.tier >= 10 ? 'Pas mal du tout ! La suite l’an prochain.' : 'Petit échauffement. On se rattrape cette saison ?'
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <ul className="flex w-full flex-col gap-1 text-left font-extrabold">
        <li>⭐ Passe : palier {e.tier} sur 20</li>
        <li>🪙 Pièces gagnées avec le passe : {e.coins_total} 🪙</li>
        <li>🛍️ Collection : {e.collection_owned} articles sur 9</li>
      </ul>
      <p className="font-bold">{comment}</p>
      <p className="text-sm font-bold text-muted">Les articles ratés reviendront l’an prochain. Promis.</p>
      <Button fullWidth onClick={onClose}>
        Voir la nouvelle saison
      </Button>
    </div>
  )
}
