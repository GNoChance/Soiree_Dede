import { useState } from 'react'
import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Modal } from '@/components/ui/Modal'
import { pickExpression, playerOrPlaceholder } from '@/features/soiree/players'
import type { GameSummaryProps } from '../types'
import { getLastGalleryMatch, useGallery, type GalleryItem } from './gallery'
import type { DrawState } from './types'

/** Fin de partie : meilleur dessinateur + galerie des dessins (stockée côté client). */
export default function DessineSummary({ state, players }: GameSummaryProps) {
  const s = state as unknown as DrawState
  const gallery = useGallery(getLastGalleryMatch())
  const [open, setOpen] = useState<GalleryItem | null>(null)
  const history = s.history ?? []
  // Ne garde que les dessins de CETTE partie (même dessinateur au même tour).
  const items = gallery.filter((g) => history.some((h) => h.turn === g.turn && h.drawer === g.drawer))

  // Meilleur artiste : celui dont les dessins ont été le plus trouvés.
  const byDrawer = new Map<string, number>()
  for (const h of history) byDrawer.set(h.drawer, (byDrawer.get(h.drawer) ?? 0) + h.found.length)
  const best = [...byDrawer.entries()].sort((a, b) => b[1] - a[1])[0]
  const artist = best && best[1] > 0 ? playerOrPlaceholder(players, best[0]) : null
  const wordOf = (g: GalleryItem) => g.word ?? history.find((h) => h.turn === g.turn)?.word ?? '?'

  if (!artist && !items.length) return null
  return (
    <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.2 }} className="sticker flex flex-col gap-3 bg-surface p-4">
      {artist && (
        <div className="flex items-center gap-3">
          <Avatar slug={artist.slug} expression={pickExpression(artist, 'gamer', 'cool', 'joie')} size={60} />
          <div>
            <p className="text-sm text-muted">Picasso de la soirée 🎨</p>
            <p className="font-display text-xl font-extrabold">
              {artist.nickname} · {best[1]} mot{best[1] > 1 ? 's' : ''} deviné{best[1] > 1 ? 's' : ''}
            </p>
          </div>
        </div>
      )}
      {items.length > 0 && (
        <>
          <p className="font-display text-lg font-extrabold">La galerie ✏️</p>
          <div className="grid grid-cols-2 gap-2.5">
            {items.map((g, i) => {
              const p = playerOrPlaceholder(players, g.drawer)
              return (
                <motion.button
                  key={g.turn}
                  type="button"
                  onClick={() => setOpen(g)}
                  initial={{ opacity: 0, scale: 0.6, rotate: i % 2 ? 6 : -6 }}
                  animate={{ opacity: 1, scale: 1, rotate: i % 2 ? 1.5 : -1.5 }}
                  whileTap={{ scale: 0.95 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 1.4 + i * 0.08 }}
                  className="sticker-sm flex flex-col overflow-hidden rounded-card bg-white text-left text-[#1f1b2e]"
                >
                  <img src={g.data} alt={`Dessin de ${p.nickname} : ${wordOf(g)}`} className="aspect-[4/3] w-full object-cover" loading="lazy" />
                  <div className="flex items-center gap-1 border-t-2 border-ink px-1.5 py-1">
                    <Avatar slug={p.slug} size={20} />
                    <span className="truncate text-xs font-extrabold">{wordOf(g)}</span>
                  </div>
                </motion.button>
              )
            })}
          </div>
        </>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open ? wordOf(open) : undefined}>
        {open && (
          <>
            <img src={open.data} alt={wordOf(open)} className="sticker-sm w-full rounded-card bg-white" />
            <p className="mt-2 text-center text-sm font-bold text-muted">par {playerOrPlaceholder(players, open.drawer).nickname}</p>
          </>
        )}
      </Modal>
    </motion.div>
  )
}
