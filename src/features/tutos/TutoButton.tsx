import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { tutoUrl } from '@/data/tutos'

/**
 * Bouton « ❓ Comment on joue ? » : ouvre la vidéo d'explication du jeu en
 * plein écran. Ne rend rien si le jeu n'a pas (encore) de vidéo (src/data/tutos.ts).
 */
export function TutoButton({ gameId, gameName, className }: { gameId: string; gameName: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const url = tutoUrl(gameId)
  if (!url) return null
  return (
    <>
      <Button size="sm" variant="secondary" className={className} onClick={() => setOpen(true)}>
        ❓ Comment on joue ?
      </Button>
      {createPortal(<AnimatePresence>{open && <TutoPlayer url={url} title={gameName} onClose={() => setOpen(false)} />}</AnimatePresence>, document.body)}
    </>
  )
}

/** Lecteur plein écran : démarre tout seul sans le son (exigence des navigateurs), gros boutons Son et Fermer. */
function TutoPlayer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [muted, setMuted] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = before
    }
  }, [onClose])

  const toggleSound = () => {
    const v = video.current
    if (!v) return
    v.muted = !muted
    setMuted(!muted)
    if (v.paused) void v.play().catch(() => {})
  }

  const round = 'flex size-14 items-center justify-center rounded-full border-[3px] border-ink shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none'
  return (
    <motion.div
      className="fixed inset-0 z-[70] flex flex-col bg-[#07050f]"
      role="dialog"
      aria-modal="true"
      aria-label={`Comment on joue à ${title}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="flex items-center justify-between gap-3 px-4 pb-2" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 12px)' }}>
        <button type="button" onClick={toggleSound} aria-label={muted ? 'Activer le son' : 'Couper le son'} className={`${round} bg-surface text-text`}>
          {muted ? <VolumeX className="size-7" strokeWidth={2.5} /> : <Volume2 className="size-7" strokeWidth={2.5} />}
        </button>
        <p className="min-w-0 flex-1 truncate text-center font-display text-xl font-extrabold text-white">{title}</p>
        <button type="button" onClick={onClose} aria-label="Fermer" className={`${round} bg-tomato text-white`}>
          <X className="size-8" strokeWidth={3} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center px-2">
        {failed ? (
          <p className="px-6 text-center font-display text-xl font-extrabold text-white">Impossible de charger la vidéo. Vérifie ta connexion et réessaie. 📶</p>
        ) : (
          <video
            ref={video}
            src={url}
            className="max-h-full max-w-full rounded-2xl"
            autoPlay
            muted
            playsInline
            controls
            preload="auto"
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="px-4 pt-2" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
        <Button size="lg" fullWidth onClick={onClose}>
          J’ai compris !
        </Button>
      </div>
    </motion.div>
  )
}
