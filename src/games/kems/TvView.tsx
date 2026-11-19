import { useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { TEAM_INFO } from '@/features/teams/teams'
import { useViewport } from '@/features/tv/tv'
import type { GamePlayProps, PlayerInfo } from '../types'
import { KemsCard } from './Card'
import { Feed, ScorePills } from './Parts'
import { RevealPanel } from './Reveal'
import { kemsActions } from './setup'
import { kemsFx } from './sound'
import type { KemsState } from './types'

/**
 * Vue télé de Kems (rendue par Play sous TvContext) : lecture seule. Seul `s` (state public) est lu :
 * AUCUNE main (elles ne sont publiques qu'à la révélation, via `call.hands`). Le centre en grand donne
 * aux joueurs une raison de lever les yeux : le signe, lui, se fait autour de la table.
 */
function useLayout() {
  const { w, h } = useViewport()
  const landscape = w > h * 1.05
  const gap = 16
  const cardW = landscape ? Math.max(70, Math.min((w * 0.6 - gap * 3) / 4, (h - 64) * 0.36)) : Math.max(56, (w - 24 - gap * 3) / 4)
  return { landscape, cardW, gap }
}

function TeamCard({ s, id, players }: { s: KemsState; id: string; players: Record<string, PlayerInfo> }) {
  const t = s.teams.find((x) => x.id === id)
  if (!t) return null
  const meta = TEAM_INFO[t.id]
  return (
    <div className="sticker-sm flex items-center gap-3 rounded-card px-3 py-2" style={{ backgroundColor: meta.soft, color: '#1f1b2e' }}>
      <span className="text-4xl">{meta.emoji}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-display text-xl font-extrabold">{meta.short}</span>
        <span className="flex -space-x-2">
          {t.players.map((p) => (
            <Avatar key={p} slug={playerOrPlaceholder(players, p).slug} tenue={playerOrPlaceholder(players, p).equippedTenue} size={44} />
          ))}
        </span>
      </div>
      <div className="flex flex-col items-center leading-none">
        <motion.span key={t.score} initial={{ scale: 1.6 }} animate={{ scale: 1 }} className="font-display text-6xl font-extrabold tabular-nums">
          {t.score}
        </motion.span>
        <span className="text-xs font-bold">sur {s.target}</span>
      </div>
    </div>
  )
}

export function KemsTv({ state, act, players }: GamePlayProps) {
  const s = state as unknown as KemsState
  const { landscape, cardW, gap } = useLayout()
  const live = s.phase === 'signs' || s.phase === 'playing' || s.phase === 'reveal'
  const left = useCountdown(live ? s.deadline : null)
  const timeUp = live && Boolean(s.deadline) && left <= 0

  // Échéance : un tick idempotent (ré-essayé tant que la phase n'a pas bougé).
  useEffect(() => {
    if (!timeUp) return
    let t = 0
    let cancelled = false
    const send = async () => {
      if (cancelled) return
      await act(kemsActions.tick())
      if (!cancelled) t = window.setTimeout(() => void send(), 2500)
    }
    t = window.setTimeout(() => void send(), 400 + Math.random() * 800)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [timeUp, act, s.deadline])

  const lastSweeps = useRef(s.sweeps)
  useEffect(() => {
    if (s.sweeps !== lastSweeps.current) {
      lastSweeps.current = s.sweeps
      kemsFx.sweep()
    }
  }, [s.sweeps])

  const center = (
    <div className="flex flex-col items-center gap-3">
      <div className="flex justify-center" style={{ gap }}>
        <AnimatePresence mode="popLayout" initial={false}>
          {s.center.map((c) => (
            <motion.div key={c} layout initial={{ opacity: 0, y: -30, rotate: -8 }} animate={{ opacity: 1, y: 0, rotate: 0 }} exit={{ opacity: 0, scale: 0.8 }} style={{ width: cardW }}>
              <KemsCard card={c} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <p className={cn('font-display font-extrabold', landscape ? 'text-3xl' : 'text-xl')}>
        🧹 Suivantes : {s.sweep.votes.length} sur {s.players.length} · 🂠 {s.deck_count}
      </p>
      <p className={cn('rounded-full border-[3px] border-ink bg-sun px-4 py-1 text-center font-display font-extrabold text-[#1f1b2e]', landscape ? 'text-2xl' : 'text-base')}>
        👀 Levez les yeux : guettez les signes des autres équipes !
      </p>
    </div>
  )

  const body =
    s.phase === 'reveal' && s.call ? (
      <div className="w-full max-w-3xl">
        <RevealPanel key={s.round} s={s} call={s.call} players={players} big={landscape} showTimer />
      </div>
    ) : s.phase === 'signs' ? (
      <div className="flex flex-col items-center gap-4 text-center">
        <p className={cn('font-display font-extrabold', landscape ? 'text-5xl' : 'text-3xl')}>🤫 Choisissez votre signe secret !</p>
        <p className={cn('font-bold text-muted', landscape ? 'text-2xl' : 'text-lg')}>Face à votre coéquipier, mettez-vous d’accord en douce. Prêts : {s.ready.length} sur {s.players.length}</p>
        <div className="flex flex-wrap justify-center gap-4">
          {s.players.map((id) => {
            const p = playerOrPlaceholder(players, id)
            const ok = s.ready.includes(id)
            return (
              <div key={id} className={cn('flex w-24 flex-col items-center', !ok && 'opacity-40')}>
                <Avatar slug={p.slug} tenue={p.equippedTenue} expression={mood(p, 'happy')} size={80} badge={ok ? '✓' : undefined} />
                <span className="w-full truncate text-base font-extrabold">{p.nickname}</span>
              </div>
            )
          })}
        </div>
      </div>
    ) : (
      <div className="flex w-full flex-col items-center gap-4">
        {center}
        <div className={cn('w-full', landscape ? 'max-w-3xl' : '')}>
          <Feed items={s.feed} players={players} count={landscape ? 4 : 3} big={landscape} />
        </div>
      </div>
    )

  const side = (
    <div className={cn('flex min-w-0 flex-col gap-3', landscape && 'w-[34%] justify-center')}>
      {landscape ? s.teams.map((t) => <TeamCard key={t.id} s={s} id={t.id} players={players} />) : <ScorePills s={s} big />}
    </div>
  )

  return (
    <div className={cn('flex h-full gap-6 p-4', landscape ? 'flex-row items-center justify-center' : 'flex-col items-center overflow-y-auto')}>
      {landscape ? (
        <>
          <div className="flex min-w-0 flex-1 items-center justify-center">{body}</div>
          {side}
        </>
      ) : (
        <>
          {side}
          {body}
        </>
      )}
    </div>
  )
}

