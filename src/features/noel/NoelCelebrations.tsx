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

/** Récompenses de Noël tout juste gagnées (pass + Grande Hotte), présentées une par une. */
export function NoelCelebrations() {
  const current = useNoelStore((s) => s.queue[0])
  const shift = useNoelStore((s) => s.shift)
  useEffect(() => {
    if (current) {
      fx.fanfare()
      victoryConfetti(1600)
    }
  }, [current])
  return (
    <Modal open={Boolean(current)} onClose={shift} title={current ? titleOf(current) : ''}>
      {current && <Body c={current} onClose={shift} />}
    </Modal>
  )
}

function titleOf(c: NoelClaim) {
  return c.kind === 'band' ? `🛷 Grande Hotte : palier ${c.tier} !` : `🎄 Pass de Noël : palier ${c.tier} !`
}

function Body({ c, onClose }: { c: NoelClaim; onClose: () => void }) {
  const it = getItem(c.item_id)
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
      {it ? (
        <motion.div initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 10 }}>
          <ItemPreview it={it} size={96} />
        </motion.div>
      ) : (
        <motion.span className="text-7xl" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 10 }}>
          🪙
        </motion.span>
      )}
      <p className="font-bold">
        {it ? `${it.label} rejoint ta collection : un exclusif de Noël !` : `+${c.coins} pièces dans ta tirelire.`}
        {c.compensated ? ` Tu l’avais déjà : ${c.coins} pièces à la place.` : ''}
        {c.kind === 'band' ? ' Merci la bande !' : ''}
      </p>
      {it && (
        <Button fullWidth onClick={() => void equip()}>
          L’équiper
        </Button>
      )}
      <Button variant={it ? 'ghost' : 'primary'} fullWidth onClick={onClose}>
        {it ? 'Plus tard' : 'Super !'}
      </Button>
    </div>
  )
}
