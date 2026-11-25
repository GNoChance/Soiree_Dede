import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router'
import { AnimatePresence, motion } from 'framer-motion'
import { Volume2, VolumeX, X } from 'lucide-react'
import { isGuestProfile } from '@/features/guest/api'
import { useSession } from '@/store/session'
import { useUpdateHold } from '@/store/updateHold'
import { useNoelState, useNoelStore } from './api'
import { introSeen, markIntroSeen, useNoelIntro } from './intro'

const SRC = '/videos/noel-2026.mp4'

/**
 * Vidéo d'annonce de l'événement de Noël : une fois par édition et par profil, à la première ouverture
 * pendant l'événement (jamais en pleine partie, jamais pour un invité) ; rejouable depuis la page Noël.
 */
export function NoelIntroVideo() {
  const profile = useSession((s) => s.profile)
  const member = Boolean(profile) && !isGuestProfile(profile)
  const { state } = useNoelState()
  const forced = useNoelIntro((s) => s.open)
  const close = useNoelIntro((s) => s.close)
  const busy = useUpdateHold((s) => s.holds > 0)
  // Aperçu admin : jamais de lecture automatique, et la vidéo n'est pas marquée « vue » (le vrai 1er décembre reste intact).
  const preview = useNoelStore((s) => s.preview !== null)
  const [auto, setAuto] = useState(false)
  // Lecture automatique seulement sur l'accueil : jamais au salon, en partie, en mode télé ou dans une page de jeu.
  const onHub = useLocation().pathname === '/'
  const [muted, setMuted] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  const key = state?.key ?? null
  useEffect(() => {
    if (member && profile && key && state?.phase === 'live' && onHub && !busy && !preview && !introSeen(key, profile.id)) setAuto(true)
  }, [member, profile, key, state?.phase, busy, preview, onHub])

  const open = member && (forced || auto)

  // Lecture avec le son si le navigateur l'accepte, sinon en muet (bouton 🔊 pour l'activer).
  useEffect(() => {
    const v = video.current
    if (!open || !v) return
    v.muted = false
    setMuted(false)
    v.play().catch(() => {
      v.muted = true
      setMuted(true)
      void v.play().catch(() => undefined)
    })
  }, [open])

  // Vidéo injoignable (réseau) : on ferme sans la marquer « vue », elle se relancera à la prochaine ouverture.
  const failed = () => {
    setAuto(false)
    close()
  }

  const done = () => {
    if (profile && key && !preview) markIntroSeen(key, profile.id)
    setAuto(false)
    close()
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#07050f]/90 p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label="Vidéo : Noël chez Dédé"
        >
          <video
            ref={video}
            src={SRC}
            className="max-h-full max-w-full rounded-2xl border-[3px] border-white/80"
            playsInline
            preload="auto"
            onEnded={done}
            onError={failed}
          />
          <button
            type="button"
            onClick={done}
            className="pt-safe absolute top-3 right-3 flex items-center gap-1 rounded-full border-[3px] border-ink bg-surface px-4 py-2 font-display font-extrabold text-text shadow-sticker-sm"
          >
            Passer <X className="size-5" strokeWidth={3} />
          </button>
          <button
            type="button"
            aria-label={muted ? 'Activer le son' : 'Couper le son'}
            onClick={() => {
              const v = video.current
              if (!v) return
              v.muted = !v.muted
              setMuted(v.muted)
            }}
            className="absolute bottom-4 left-1/2 flex size-14 -translate-x-1/2 items-center justify-center rounded-full border-[3px] border-ink bg-surface text-text shadow-sticker-sm"
          >
            {muted ? <VolumeX className="size-6" strokeWidth={3} /> : <Volume2 className="size-6" strokeWidth={3} />}
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
