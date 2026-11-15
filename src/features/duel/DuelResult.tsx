import { useEffect } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { FastForward } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { burst } from '@/components/ui/confetti'
import { mood, pickExpression } from '@/features/soiree/players'
import { fx } from '@/lib/feedback'
import type { PlayerInfo } from '@/games/types'
import { DUEL_POINTS } from './logic'
import type { DuelInfo, DuelSession } from './types'

export interface DuelResultBannerProps {
  duel: DuelInfo
  session: DuelSession
  meId: string
  get: (id: string) => PlayerInfo
  colors: { a: string; b: string }
  left: number
  isHost: boolean
  pending: boolean
  onNext: () => void
}

/**
 * Bandeau de fin de manche / de duel (phase `result`) : vainqueur, nul,
 * points gagnés, paris justes ; confettis. Affiché sous le plateau (qui garde
 * sa propre mise en valeur : ligne gagnante…).
 */
export function DuelResultBanner({ duel, session, meId, get, colors, left, isHost, pending, onNext }: DuelResultBannerProps) {
  const reduce = useReducedMotion()
  const res = duel.result
  const gameWinner = duel.outcome === 'win' ? duel.winner : null
  const winner = res ? res.winner : gameWinner
  const draw = res ? res.draw : duel.outcome === 'draw'
  const w = winner ? get(winner) : null
  const side = winner === duel.a ? 'a' : 'b'
  const secs = Math.ceil(left / 1000)

  useEffect(() => {
    if (winner) {
      burst({ x: 0.5, y: 0.45 }, res ? 160 : 90)
      if (winner === meId) fx.fanfare()
      else if (meId === duel.a || meId === duel.b) fx.fail()
      else fx.success()
    } else {
      fx.whoosh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une célébration par manche
  }, [duel.no, duel.game_no])

  const title = draw
    ? res
      ? 'Match nul !'
      : 'Manche nulle !'
    : res
      ? winner === meId
        ? 'Tu remportes le duel !'
        : `${w?.nickname} remporte le duel !`
      : winner === meId
        ? 'Tu gagnes la manche !'
        : `${w?.nickname} gagne la manche !`

  let detail: string
  if (res) {
    detail = res.draw ? `+${DUEL_POINTS.draw} pt chacun` : `+${DUEL_POINTS.win} pts pour ${w?.nickname}`
    if (res.advanced) detail += ` · tirage au sort : ${get(res.advanced).nickname} passe au tour suivant 🎲`
    else if (res.draw && session.mode === 'tournament') detail += ' · on rejoue !'
    else if (res.draw && session.mode === 'king') detail += ' · les deux retournent dans la file'
  } else {
    const wa = duel.wins[duel.a] ?? 0
    const wb = duel.wins[duel.b] ?? 0
    detail = `${get(duel.a).nickname} ${wa} – ${wb} ${get(duel.b).nickname} · manche suivante…`
  }

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { y: 60, scale: 0.7, rotate: -4, opacity: 0 }}
      animate={{ y: 0, scale: 1, rotate: 0, opacity: 1 }}
      exit={{ y: 40, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 16 }}
      className="sticker relative flex flex-col items-center gap-2 overflow-hidden p-3 text-center text-[#1f1b2e]"
      style={{ background: w ? colors[side] : '#4CC9F0' }}
    >
      <div className="flex items-center gap-3">
        {w ? (
          <motion.div animate={reduce ? undefined : { y: [0, -8, 0], rotate: [-3, 3, -3] }} transition={{ repeat: Infinity, duration: 0.9 }}>
            <ChibiImage slug={w.slug} expression={pickExpression(w, 'cool', 'pouces', 'gamer', 'joie')} tenue={w.equippedTenue} size={88} />
          </motion.div>
        ) : (
          <div className="flex -space-x-4">
            {[duel.a, duel.b].map((id) => (
              <ChibiImage key={id} slug={get(id).slug} expression={mood(get(id), 'shocked')} tenue={get(id).equippedTenue} size={70} />
            ))}
          </div>
        )}
        <div className="flex flex-col items-start text-left">
          <span className="font-display text-2xl leading-tight font-extrabold" style={{ textShadow: '2px 2px 0 rgba(255,255,255,.6)' }}>
            {title}
          </span>
          <span className="text-sm font-bold">{detail}</span>
        </div>
      </div>
      {res && res.bets_right.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1 rounded-full border-2 border-ink bg-surface px-2 py-0.5 text-text">
          <span className="text-xs font-extrabold">Pari gagnant (+{DUEL_POINTS.bet}) :</span>
          {res.bets_right.map((id) => (
            <Avatar key={id} slug={get(id).slug} expression={mood(get(id), 'happy')} size={22} />
          ))}
        </div>
      )}
      <div className="flex w-full items-center justify-between gap-2">
        <span className="text-xs font-bold">
          {res ? (session.over ? 'Fin de la session' : 'Prochain duel') : 'Manche suivante'} dans {Math.max(0, secs)} s
        </span>
        {isHost && (
          <Button variant="secondary" size="sm" icon={<FastForward className="size-4" />} disabled={pending} onClick={onNext}>
            Suite
          </Button>
        )}
      </div>
    </motion.div>
  )
}
