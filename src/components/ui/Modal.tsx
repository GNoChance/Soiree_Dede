import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useDragControls } from 'framer-motion'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { fx } from '@/lib/feedback'

interface BaseProps {
  open: boolean
  onClose: () => void
  title?: string
  children?: ReactNode
  className?: string
}

/**
 * Verrou de défilement partagé : compteur des modales ouvertes, pour qu'une
 * modale qui se ferme (ou une navigation) ne laisse jamais la page bloquée.
 */
let scrollLocks = 0
function lockScroll() {
  scrollLocks++
  document.body.style.overflow = 'hidden'
}
function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1)
  if (scrollLocks === 0) document.body.style.overflow = ''
}

/** Filet de sécurité appelé à chaque changement de page. */
export function releaseScrollIfIdle() {
  if (scrollLocks === 0) document.body.style.overflow = ''
}

function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  useEffect(() => {
    if (!open) return
    lockScroll()
    return unlockScroll
  }, [open])
}

function Backdrop({ onClick }: { onClick: () => void }) {
  return (
    <motion.div
      className="absolute inset-0 bg-[#07050f]/60 backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClick}
    />
  )
}

function Header({ title, onClose }: { title?: string; onClose: () => void }) {
  if (!title) return null
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-2xl">{title}</h2>
      <button
        aria-label="Fermer"
        onClick={onClose}
        className="flex size-10 items-center justify-center rounded-full border-[3px] border-ink bg-surface text-text shadow-sticker-sm active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
      >
        <X className="size-5" strokeWidth={3} />
      </button>
    </div>
  )
}

/** Fenetre centree, entree en rebond. */
export function Modal({ open, onClose, title, children, className }: BaseProps) {
  useEscape(open, onClose)
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-5" role="dialog" aria-modal="true">
          <Backdrop onClick={onClose} />
          <motion.div
            className={cn('sticker relative max-h-[85dvh] w-full max-w-sm overflow-auto rounded-bubble bg-surface p-5 text-text', className)}
            initial={{ scale: 0.6, rotate: -6, opacity: 0, y: 40 }}
            animate={{ scale: 1, rotate: 0, opacity: 1, y: 0 }}
            exit={{ scale: 0.8, opacity: 0, y: 20, transition: { duration: 0.15 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 17 }}
            onAnimationStart={() => fx.whoosh()}
          >
            <Header title={title} onClose={onClose} />
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Feuille qui monte du bas, fermable par glissement vers le bas. */
/**
 * Feuille qui monte du bas. Le CONTENU défile normalement au doigt ; seule la
 * poignée / l'en-tête permet de tirer la feuille vers le bas pour la fermer
 * (avant, toute la feuille captait le glissement et empêchait de défiler).
 * `footer` reste toujours visible en bas de la feuille (bouton d'action).
 */
export function BottomSheet({ open, onClose, title, children, className, footer }: BaseProps & { footer?: ReactNode }) {
  useEscape(open, onClose)
  const controls = useDragControls()
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end" role="dialog" aria-modal="true">
          <Backdrop onClick={onClose} />
          <motion.div
            className={cn(
              'sticker relative flex max-h-[88dvh] w-full flex-col rounded-b-none rounded-t-bubble border-b-0 bg-surface text-text',
              className,
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%', transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose()
            }}
          >
            <div
              className="shrink-0 cursor-grab touch-none px-5 pt-3"
              onPointerDown={(e) => controls.start(e)}
            >
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-ink/40" />
              <Header title={title} onClose={onClose} />
            </div>
            <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5', footer ? 'pb-3' : 'pb-safe pb-5')}>
              {children}
            </div>
            {footer && <div className="pb-safe shrink-0 border-t-2 border-ink/10 px-5 pt-3 pb-4">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
