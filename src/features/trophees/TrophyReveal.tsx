import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { Modal } from '@/components/ui/Modal'
import { confettiRain } from '@/components/ui/confetti'
import { tenueStickerAt } from '@/components/ui/tenueArt'
import { getExpression } from '@/data/expressions'
import { getTenue, SECRET_TENUES } from '@/data/tenues'
import { getTrophy } from '@/data/trophees'
import type { PlayerInfo } from '@/games/types'
import { fx } from '@/lib/feedback'
import { useSession } from '@/store/session'

/**
 * Célèbre mes nouveaux trophées (un par carte) et liste ceux des autres joueurs.
 * `trophies` = new_trophies du serveur ({profile_id: [trophy_id]}). Même style que TenueUnlockReveal.
 */
export function TrophyUnlockReveal({
  trophies, meId, players, onClose,
}: {
  trophies: Record<string, string[]> | null | undefined
  meId: string
  players: Record<string, PlayerInfo>
  onClose: () => void
}) {
  const reduce = useReducedMotion()
  const tenueUnlocks = useSession((s) => s.tenueUnlocks)
  const mine = trophies?.[meId] ?? []
  const others = Object.entries(trophies ?? {}).filter(([id, list]) => id !== meId && list.length)
  const [idx, setIdx] = useState(0)
  const me = players[meId]
  const open = mine.length > 0 || others.length > 0

  useEffect(() => {
    if (mine.length) {
      fx.fanfare()
      confettiRain(2000)
    }
  }, [mine.length])

  if (!open) return null
  const t = mine[idx] ? getTrophy(mine[idx]) : undefined
  const tenue = t?.tenue ? getTenue(t.tenue) : undefined
  const sticker = me && t?.tenue && t.slot ? tenueStickerAt(me.slug, t.tenue, t.slot) : null
  const owned = Boolean(t?.tenue && tenueUnlocks[t.tenue])
  // Trophée qui offre une tenue secrète (Madame Irma) : on dévoile la surprise (sinon, personne ne la voit venir).
  const secret = t ? SECRET_TENUES.find((x) => x.secretTrophy === t.id) : undefined

  return (
    <Modal open onClose={onClose} title={mine.length ? (mine.length > 1 ? 'Nouveaux trophées !' : 'Nouveau trophée !') : 'Trophées des autres'}>
      <div className="flex flex-col items-center gap-4">
        {t && (
          <motion.div
            key={t.id}
            initial={reduce ? false : { scale: 0.3, rotate: -14 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 11 }}
            className="sticker flex w-full flex-col items-center gap-2 bg-sun p-4 text-center text-[#1f1b2e]"
          >
            <span className="text-6xl leading-none">🏆</span>
            <p className="font-display text-2xl leading-tight font-extrabold">{t.name}</p>
            <p className="text-sm font-bold">{t.condition}</p>
            {tenue && me && sticker && (
              <div className="mt-1 flex flex-col items-center gap-1 rounded-card border-[3px] border-ink bg-surface px-3 py-2 text-text">
                <ChibiImage slug={me.slug} tenue={t.tenue ?? undefined} expression={sticker} size={110} />
                <p className="text-sm font-extrabold">
                  Sticker « {getExpression(sticker)?.label ?? 'bonus'} » {tenue.emoji} {tenue.label}
                </p>
                <p className="text-xs font-bold text-muted">{owned ? 'Utilisable tout de suite !' : 'Utilisable dès que tu auras cette tenue.'}</p>
              </div>
            )}
            {tenue && !sticker && <p className="text-xs font-bold">Badge {tenue.emoji} ajouté à ton profil.</p>}
            {secret && me && (
              <motion.div
                initial={reduce ? false : { scale: 0, rotate: -20, opacity: 0 }}
                animate={{ scale: 1, rotate: 0, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 180, damping: 9, delay: 0.5 }}
                className="mt-1 flex flex-col items-center gap-1 rounded-card border-[3px] border-ink bg-surface px-3 py-2 text-text"
              >
                <p className="font-display text-sm font-extrabold">{secret.emoji} Surprise ! Une tenue secrète !</p>
                <ChibiImage slug={me.slug} tenue={secret.id} expression="joie" size={110} />
                <p className="text-sm font-extrabold">{secret.label} : 12 stickers rien que pour toi</p>
                <p className="text-xs font-bold text-muted">À équiper dans Inventaire › Tenues.</p>
              </motion.div>
            )}
          </motion.div>
        )}
        {mine.length > 1 && (
          <p className="font-display font-extrabold text-muted">
            {idx + 1} / {mine.length}
          </p>
        )}
        {others.length > 0 && (
          <div className="w-full rounded-card border-2 border-ink/30 bg-sunk p-3">
            <p className="mb-2 font-display font-extrabold">Chez les autres :</p>
            <ul className="flex flex-col gap-1">
              {others.map(([id, list]) => (
                <li key={id} className="flex items-center gap-2">
                  {players[id] && <Avatar slug={players[id].slug} expression={players[id].equipped} tenue={players[id].equippedTenue} size={32} />}
                  <span className="font-bold">
                    {players[id]?.nickname ?? '?'} : {list.map((x) => getTrophy(x)?.name ?? x).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {idx < mine.length - 1 ? (
          <Button fullWidth onClick={() => setIdx((i) => i + 1)}>
            Suivant !
          </Button>
        ) : (
          <Button fullWidth onClick={onClose}>
            Génial !
          </Button>
        )}
      </div>
    </Modal>
  )
}
