import { useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useSession } from '@/store/session'
import { getGame } from '@/games/registry'
import { useActiveSoireesStore } from '@/features/soiree/activeSoirees'
import { fx } from '@/lib/feedback'
import { readScenario } from './api'
import { getTheme } from './themes'

/**
 * Soirée scénarisée vue de partout : un joueur hors du salon (écran de fin de partie, accueil…)
 * voit une pastille quand un défi surprise ou un nouveau tirage l'attend au salon.
 * Pas de pastille pendant une partie, ni dans le salon concerné (il affiche déjà tout).
 */
export function ReveillonWatcher() {
  const meId = useSession((s) => s.profile?.id)
  const soirees = useActiveSoireesStore((s) => s.soirees)
  const viewing = useActiveSoireesStore((s) => s.viewing)
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState<string[]>([])
  if (!meId) return null

  const pills = soirees.flatMap((s) => {
    const sc = s.status === 'ended' ? null : readScenario(s)
    if (!sc || sc.phase === 'playing') return []
    if (viewing?.soireeId === s.id && viewing.kind === 'salon') return []
    const key = `${s.id}:${sc.phase}:${sc.round}:${sc.draw}`
    if (dismissed.includes(key)) return []
    const theme = getTheme(sc.theme)
    const g = getGame(sc.game_id)
    const text =
      sc.phase === 'challenge' ? '🎁 Défi surprise au salon !' : sc.phase === 'draw' ? `Manche ${sc.round} : ${g?.emoji ?? '🎲'} ${g?.name ?? 'nouveau jeu'} !` : '🏆 Classement final au salon !'
    return [{ key, soireeId: s.id, text, theme }]
  })
  const pill = pills[0]

  return createPortal(
    <AnimatePresence>
      {pill && (
        <motion.div
          key={pill.key}
          initial={{ y: 80, opacity: 0, rotate: -4 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 16 }}
          className="fixed right-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[46] flex max-w-[calc(100vw-5rem)] items-center gap-1"
        >
          <button
            type="button"
            onClick={() => {
              fx.pop()
              navigate(`/soiree/${pill.soireeId}`)
            }}
            className="sticker flex min-h-14 items-center gap-2 rounded-bubble px-4 py-2 text-left font-display text-lg leading-tight font-extrabold text-[#1f1b2e]"
            style={{ backgroundColor: pill.theme.color }}
          >
            <span className="text-2xl">{pill.theme.emoji}</span>
            <span>{pill.text}</span>
          </button>
          <button
            type="button"
            aria-label="Masquer"
            onClick={() => setDismissed((d) => [...d, pill.key])}
            className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface text-text shadow-sticker-sm"
          >
            <X className="size-4" strokeWidth={3} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
