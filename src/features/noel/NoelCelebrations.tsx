import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { victoryConfetti } from '@/components/ui/confetti'
import { getItem } from '@/data/cadeaux'
import { equipItem } from '@/features/cadeaux/api'
import { ItemPreview } from '@/features/cadeaux/ItemPreview'
import { toastError } from '@/features/soiree/errors'
import { fx } from '@/lib/feedback'
import { toast } from '@/store/toast'
import { useNoelStore, type NoelClaim } from './api'

/** Nouvelles récompenses de Noël (pass + Grande Hotte) : UNE modale qui les liste toutes (spec §8.4). */
export function NoelCelebrations() {
  const queue = useNoelStore((s) => s.queue)
  const clear = useNoelStore((s) => s.clearQueue)
  const open = queue.length > 0
  useEffect(() => {
    if (open) {
      fx.fanfare()
      victoryConfetti(1600)
    }
  }, [open])
  const pass = queue.filter((c) => c.kind === 'pass')
  const band = queue.filter((c) => c.kind === 'band')
  const title = band.some((c) => c.tier === 5)
    ? '🎁 LE GROS LOT DE LA BANDE !'
    : band.length && !pass.length
    ? '🛷 La Grande Hotte avance !'
    : pass.length === 1 && !band.length
      ? `🎄 Pass de Noël : palier ${pass[0].tier} !`
      : '🎁 Nouveaux cadeaux de Noël !'
  const coins = queue.reduce((n, c) => n + c.coins, 0)
  return (
    <Modal open={open} onClose={clear} title={title}>
      <div className="flex flex-col gap-3">
        <div className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto">
          {queue.map((c) => (
            <ClaimRow key={`${c.kind}-${c.tier}`} c={c} />
          ))}
        </div>
        {coins > 0 && <p className="text-center font-display text-xl font-extrabold">Total : +{coins} 🪙</p>}
        {band.length > 0 && <p className="text-center font-bold">Merci la bande ! 🛷</p>}
        <Button fullWidth size="lg" onClick={clear}>
          Super !
        </Button>
      </div>
    </Modal>
  )
}

function ClaimRow({ c }: { c: NoelClaim }) {
  const it = getItem(c.item_id)
  const equip = async () => {
    if (!it) return
    try {
      await equipItem(it.slot, it.id)
      fx.pop()
      toast.success(`${it.emoji} ${it.label} équipé !`)
    } catch (e) {
      toastError(e)
    }
  }
  return (
    <motion.div
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className="sticker-sm flex items-center gap-3 rounded-card bg-surface p-2"
    >
      <div className="flex size-14 shrink-0 items-center justify-center text-4xl">
        {it ? <ItemPreview it={it} size={52} /> : c.kind === 'band' && c.tier === 5 ? '🎁' : '🪙'}
      </div>
      <div className="min-w-0 flex-1 text-left">
        <p className="font-display font-extrabold">{c.kind === 'band' ? (c.tier === 5 ? '🎁 Gros Lot de la Grande Hotte' : `Grande Hotte · palier ${c.tier}`) : `Pass · palier ${c.tier}`}</p>
        <p className="text-sm font-bold">
          {c.kind === 'band' && c.tier === 5
            ? `${c.coins} pièces, trophée « Esprit d’équipe », thème secret du Réveillon et plaque souvenir dans l’album !`
            : c.compensated
            ? `Objet déjà à toi : ${c.coins} pièces à la place`
            : it
              ? `${it.label}${c.coins > 0 ? ` + ${c.coins} pièces` : ''}`
              : `${c.coins} pièces`}
        </p>
      </div>
      {it && (
        <Button size="sm" variant="secondary" onClick={() => void equip()}>
          Équiper
        </Button>
      )}
    </motion.div>
  )
}
