import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { useDictionary } from './useDictionary'

/** Pastille d'état du dictionnaire (chargement en arrière-plan). */
export function DictIndicator({ className }: { className?: string }) {
  const d = useDictionary()
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 self-start rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-extrabold shadow-sticker-sm',
        d.status === 'ready' ? 'bg-mint text-[#1f1b2e]' : d.status === 'off' ? 'bg-sunk text-muted' : 'bg-sun text-[#1f1b2e]',
        className,
      )}
      aria-live="polite"
    >
      {d.status === 'loading' ? (
        <>
          <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: 'linear' }} className="inline-block">
            📖
          </motion.span>
          Chargement du dico… (mots acceptés en attendant)
        </>
      ) : d.status === 'ready' ? (
        <>📖 Dico prêt · {d.size.toLocaleString('fr-FR')} mots</>
      ) : (
        <>📖 Dico indisponible : on vous fait confiance 😇</>
      )}
    </div>
  )
}
