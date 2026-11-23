import { motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import type { PlayerInfo } from '../types'
import { FaceIcon } from './Dice'
import type { MtrState } from './types'

/** « Moments de la partie » : enchère la plus audacieuse et meilleur bluff, rejoués depuis history[]. */
export function MtrMoments({ s, players }: { s: MtrState; players: Record<string, PlayerInfo> }) {
  const history = s.history ?? []
  // Enchère la plus audacieuse : la plus haute quantité annoncée (à égalité, la plus ancienne).
  let bold: (typeof history)[number] | null = null
  for (const h of history) if (h.bid && (!bold || h.bid.qty > bold.bid.qty)) bold = h
  if (bold && bold.bid.qty < 5) bold = null
  // Meilleur bluff : enchère fausse que personne n'a démasquée (l'accusateur a perdu un dé), plus gros écart.
  let bluff: (typeof history)[number] | null = null
  for (const h of history) {
    if (h.kind !== 'liar' || !h.loser || h.loser !== h.caller || h.count >= h.bid.qty) continue
    if (!bluff || h.bid.qty - h.count > bluff.bid.qty - bluff.count) bluff = h
  }
  if (!bold && !bluff) return null

  const rows: Array<{ key: string; emoji: string; title: string; id: string; expr: Parameters<typeof mood>[1]; detail: React.ReactNode }> = []
  if (bold)
    rows.push({
      key: 'bold', emoji: '🚀', title: "L'enchère la plus audacieuse", id: bold.bid.by, expr: 'proud',
      detail: (
        <span className="inline-flex items-center gap-1">
          {bold.bid.qty} × <FaceIcon value={bold.bid.face} size={16} /> annoncés, {bold.count} sur la table
        </span>
      ),
    })
  if (bluff)
    rows.push({
      key: 'bluff', emoji: '🎭', title: 'Le meilleur bluff', id: bluff.bid.by, expr: 'sly',
      detail: (
        <span className="inline-flex flex-wrap items-center gap-1">
          {bluff.bid.qty} × <FaceIcon value={bluff.bid.face} size={16} /> pour {bluff.count} réel{bluff.count > 1 ? 's' : ''}, et personne n'a rien vu !
        </span>
      ),
    })
  return (
    <div className="sticker flex flex-col gap-2 bg-surface p-3">
      <p className="font-display text-lg font-extrabold">Moments de la partie ✨</p>
      {rows.map((r, i) => {
        const p = playerOrPlaceholder(players, r.id)
        return (
          <motion.div
            key={r.key}
            initial={{ x: -40, opacity: 0, rotate: -3 }}
            animate={{ x: 0, opacity: 1, rotate: 0 }}
            transition={{ delay: 0.8 + i * 0.15, type: 'spring', stiffness: 300, damping: 18 }}
            className="flex items-center gap-3 rounded-chip bg-sunk p-2"
          >
            <Avatar slug={p.slug} expression={mood(p, r.expr)} size={48} />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-muted">
                {r.emoji} {r.title}
              </p>
              <p className="truncate font-display text-lg font-extrabold">{p.nickname}</p>
              <p className="text-sm font-bold text-muted">{r.detail}</p>
            </div>
          </motion.div>
        )
      })}
    </div>
  )
}
