import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Lock, QrCode, Share2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { fx } from '@/lib/feedback'
import { toast } from '@/store/toast'
import { toastError } from '@/features/soiree/errors'
import { closeGuestInvites, inviteUrl, openGuestInvites, type GuestInvite } from './api'
import { qrMatrix, qrSvgPath } from './qr'

/** QR code noir sur blanc (lisible par les appareils photo, quel que soit le thème). */
export function QrSvg({ text, size = 240 }: { text: string; size?: number }) {
  const qr = useMemo(() => {
    try {
      return qrSvgPath(qrMatrix(text))
    } catch {
      return null
    }
  }, [text])
  if (!qr) return null
  return (
    <svg
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      width={size}
      height={size}
      role="img"
      aria-label="QR code d’invitation"
      shapeRendering="crispEdges"
      className="rounded-2xl border-[3px] border-ink shadow-sticker"
      style={{ background: '#ffffff' }}
    >
      <path d={qr.path} fill="#1f1b2e" />
    </svg>
  )
}

/** Bouton de l'hôte (salon) : afficher le QR code d'invitation pour une personne de passage. */
export function GuestInviteButton({ soireeId, code }: { soireeId: string; code: string }) {
  const [open, setOpen] = useState(false)
  const [invite, setInvite] = useState<GuestInvite | null>(null)
  const [busy, setBusy] = useState(false)

  const show = async () => {
    setOpen(true)
    setBusy(true)
    try {
      setInvite(await openGuestInvites(soireeId))
      fx.pop()
    } catch (e) {
      toastError(e)
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const close = async () => {
    try {
      await closeGuestInvites(soireeId)
      toast.success('Invitations fermées : le QR code ne marche plus.')
      setInvite(null)
      setOpen(false)
    } catch (e) {
      toastError(e)
    }
  }

  const url = invite ? inviteUrl(invite.token) : ''
  const share = async () => {
    const text = 'Viens jouer avec nous aux Soirées de Dédé (sans compte) !'
    try {
      if (navigator.share) await navigator.share({ title: 'Soirée de Dédé', text, url })
      else {
        await navigator.clipboard.writeText(url)
        toast.success('Lien copié !')
      }
    } catch {
      /* partage annulé */
    }
  }

  return (
    <>
      <Button variant="secondary" fullWidth icon={<QrCode className="size-5" />} onClick={() => void show()}>
        Inviter quelqu’un de passage
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Quelqu’un de passage ?">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="font-bold">Fais scanner ce QR code avec l’appareil photo du téléphone :</p>
          {invite ? (
            <motion.div initial={{ scale: 0.5, rotate: -8 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
              <QrSvg text={url} />
            </motion.div>
          ) : (
            <div className="size-[240px] animate-pulse rounded-2xl border-[3px] border-ink bg-sunk" aria-busy={busy} />
          )}
          <div className="flex flex-col items-center gap-1">
            <p className="text-sm font-bold text-muted">ou ouvrir l’app et taper le code</p>
            <p className="font-display text-5xl font-extrabold tracking-[0.2em]">{code}</p>
            {invite && <p className="text-xs font-bold break-all text-muted">{url.replace(/^https?:\/\//, '')}</p>}
          </div>
          <p className="rounded-chip bg-sunk px-3 py-2 text-sm font-bold">
            👋 Sans compte ni PIN : on joue ici, mais ça ne compte pas pour les classements, l’XP et les trophées de la bande.
            {invite ? ` (${invite.guests}/${invite.max_guests} personnes de passage)` : ''}
          </p>
          <div className="flex w-full flex-col gap-2">
            <Button fullWidth icon={<Share2 className="size-5" />} disabled={!invite} onClick={() => void share()}>
              Envoyer le lien
            </Button>
            <Button variant="ghost" fullWidth icon={<Lock className="size-5" />} disabled={!invite} onClick={() => void close()}>
              Fermer les invitations
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
