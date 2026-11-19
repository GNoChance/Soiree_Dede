import { useEffect } from 'react'
import { motion, useAnimationControls } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { burst } from '@/components/ui/confetti'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { TEAM_INFO } from '@/features/teams/teams'
import type { PlayerInfo } from '../types'
import { KemsCard } from './Card'
import { callHeadline, isSquare } from './logic'
import { kemsFx } from './sound'
import type { KemsCall, KemsState } from './types'

/**
 * Révélation d'une manche : titre (KEMS ! / CONTRE-KEMS ! / Raté…), points gagnés, et les mains de tous
 * retournées (carrés mis en valeur). Aussi utilisée par le Summary (fin de partie) et la télé.
 * `animate` : joue sons / confettis / secousse (une seule fois par manche).
 */
export function RevealPanel({
  s,
  call,
  players,
  big,
  animate = true,
  showTimer,
}: {
  s: KemsState
  call: KemsCall
  players: Record<string, PlayerInfo>
  big?: boolean
  animate?: boolean
  /** Barre des 6 s avant la manche suivante. */
  showTimer?: boolean
}) {
  const get = (id: string) => playerOrPlaceholder(players, id)
  const controls = useAnimationControls()
  const team = call.team ? TEAM_INFO[call.team] : null
  const by = call.by ? get(call.by) : null
  const good = call.ok
  const left = useCountdown(showTimer ? s.deadline : null, 100)

  useEffect(() => {
    if (!animate) return
    if (call.type === 'timeout') {
      kemsFx.blank()
      return
    }
    if (good) {
      kemsFx.shout()
      burst({ x: 0.5, y: 0.25 }, call.double ? 160 : 100)
    } else {
      kemsFx.miss()
      void controls.start({ x: [0, -14, 14, -10, 10, 0], transition: { duration: 0.5 } })
    }
    // une seule fois par manche
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.round, animate])

  const who = by ? by.nickname : ''
  const sub =
    call.type === 'timeout'
      ? 'Personne n’a rien vu passer : on redistribue sans point.'
      : call.type === 'kems'
        ? good
          ? `${who} crie pour ${call.double ? 'ses deux carrés' : 'le carré de son coéquipier'} !`
          : `${who} a crié… mais son coéquipier n’a pas de carré !`
        : good
          ? `${who} a repéré le signe des ${call.target ? TEAM_INFO[call.target].short : ''} !`
          : `${who} accusait les ${call.target ? TEAM_INFO[call.target].short : ''} à tort…`

  const deltas = Object.entries(call.deltas).filter(([, n]) => (n ?? 0) > 0) as Array<[keyof typeof TEAM_INFO, number]>

  return (
    <motion.div animate={controls} className={cn('flex flex-col', big ? 'gap-2' : 'gap-3')}>
      <motion.div
        initial={{ scale: 0.5, rotate: -6, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 280, damping: 11 }}
        className="sticker flex flex-col items-center gap-2 rounded-card p-4 text-center"
        style={team && good ? { backgroundColor: team.color, color: team.text } : { backgroundColor: 'var(--surface)' }}
      >
        <div className="flex items-center justify-center gap-3">
          {by && <Avatar slug={by.slug} tenue={by.equippedTenue} expression={mood(by, good ? 'proud' : 'sad')} size={big ? 96 : 64} bounce={good} />}
          <p className={cn('font-display font-extrabold leading-tight', big ? 'text-5xl' : 'text-3xl')}>
            {call.type === 'timeout' ? '⏳' : good ? (call.type === 'kems' ? '🤠' : '🕵️') : '😬'} {callHeadline(call)}
          </p>
        </div>
        <p className={cn('font-bold', big ? 'text-2xl' : 'text-sm')}>{sub}</p>
        {deltas.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2">
            {deltas.map(([id, n], i) => (
              <motion.span
                key={id}
                initial={{ scale: 0, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                transition={{ delay: 0.4 + i * 0.15, type: 'spring', stiffness: 420, damping: 12 }}
                className={cn('sticker-sm rounded-full bg-surface px-3 py-0.5 font-display font-extrabold text-text', big ? 'text-4xl' : 'text-xl')}
              >
                +{n} {TEAM_INFO[id].emoji}
              </motion.span>
            ))}
          </div>
        )}
      </motion.div>

      <div className={cn('grid gap-2', s.teams.length > 2 && !big ? 'grid-cols-1' : s.teams.length > 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {s.teams.map((t) => {
          const meta = TEAM_INFO[t.id]
          return (
            <div key={t.id} className="sticker-sm flex flex-col gap-1.5 rounded-card p-2" style={{ backgroundColor: meta.soft, color: '#1f1b2e' }}>
              <p className={cn('font-display font-extrabold', big ? 'text-2xl' : 'text-base')} style={{ color: meta.color === '#ffc43d' ? '#9a6b00' : meta.color }}>
                {meta.emoji} {meta.short}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {t.players.map((pid) => {
                  const hand = call.hands[pid] ?? []
                  const sq = isSquare(hand)
                  const p = get(pid)
                  return (
                    <div key={pid} className="flex flex-col gap-1">
                      <div className="flex items-center gap-1">
                        <Avatar slug={p.slug} tenue={p.equippedTenue} size={big ? 40 : 28} />
                        <span className={cn('min-w-0 flex-1 truncate font-extrabold', big ? 'text-lg' : 'text-xs')}>{p.nickname}</span>
                        {sq && <span className={cn('rounded-full bg-mint px-1.5 font-display font-extrabold text-ink', big ? 'text-base' : 'text-[10px]')}>Carré !</span>}
                      </div>
                      <div className={cn('grid grid-cols-4 gap-1', big && 'max-w-[280px]')}>
                        {hand.map((c, i) => (
                          <motion.div key={c} initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ delay: 0.3 + i * 0.08 }}>
                            <KemsCard card={c} mini glow={sq} />
                          </motion.div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {showTimer && (
        <div className="h-2 overflow-hidden rounded-full border-2 border-ink bg-sunk" aria-hidden>
          <div className="h-full bg-sun" style={{ width: `${Math.min(100, (left / 6000) * 100)}%` }} />
        </div>
      )}
    </motion.div>
  )
}
