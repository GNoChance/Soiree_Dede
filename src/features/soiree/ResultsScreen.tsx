import { Suspense, useEffect, useRef, useState } from 'react'
import { animate, motion, useReducedMotion } from 'framer-motion'
import { Home, Sparkles } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { treesConfetti, victoryConfetti } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import { refreshProfile } from '@/lib/auth'
import type { BaseGameState, GameDefinition, PlayerInfo } from '@/games/types'
import { PronosResult } from '@/features/pronos/PronosResult'
import { TrophyUnlockReveal } from '@/features/trophees/TrophyReveal'
import { TenueUnlockReveal, UnlockReveal } from './components'
import { mood, playerOrPlaceholder } from './players'
import type { SoireeData } from './hooks'
import { RematchButton } from './RematchButton'

function CountUp({ to, delay = 0 }: { to: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const reduce = useReducedMotion()
  useEffect(() => {
    const c = animate(0, to, {
      duration: reduce ? 0 : 1.6,
      delay: reduce ? 0 : delay,
      ease: 'easeOut',
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = String(Math.round(v))
      },
    })
    return () => c.stop()
  }, [to, delay, reduce])
  return <span ref={ref}>0</span>
}

const PODIUM_H = { 1: 'h-28', 2: 'h-20', 3: 'h-14' } as const
const MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' } as const

export function ResultsScreen({ matchId, state, meId, players, game, onBack, rematch }: { matchId: string; state: BaseGameState; meId: string; players: Record<string, PlayerInfo>; game: GameDefinition | undefined; onBack: () => void; rematch?: { soireeData: SoireeData | null; onStarted: (matchId: string, game: string) => void } }) {
  const results = [...(state.results ?? [])].sort((a, b) => a.placement - b.placement)
  const me = results.find((r) => r.profile_id === meId)
  const xp = state.xp_gained?.[meId] ?? 0
  // Révélations enchaînées : expressions, tenues, puis trophées.
  const [reveal, setReveal] = useState<'none' | 'expressions' | 'tenues' | 'trophies'>('none')
  const hasUnlocks = Object.values(state.new_unlocks ?? {}).some((l) => l.length)
  const hasTenues = Object.values(state.new_tenues ?? {}).some((l) => l.length)
  const hasTrophies = Object.values(state.new_trophies ?? {}).some((l) => l.length)
  const Summary = game?.Summary

  useEffect(() => {
    if (me?.won) {
      fx.fanfare()
      // Effet « Pluie de sapins » équipé (slot fx_victoire) : 🎄🎁⭐ au lieu des confettis.
      if (players[meId]?.equippedItems?.fx_victoire === 'fx_sapins') treesConfetti(2600)
      else victoryConfetti(2200)
    } else if (me) {
      fx.whoosh()
    }
    void refreshProfile().catch(() => undefined)
    const t = window.setTimeout(() => setReveal(hasUnlocks ? 'expressions' : hasTenues ? 'tenues' : hasTrophies ? 'trophies' : 'none'), 2800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- une seule célébration par écran
  }, [])

  // Podium : places 1 à 3 (ex-aequo possibles), affichées 2 - 1 - 3.
  const byPlace = (n: number) => results.filter((r) => r.placement === n)
  const podium = [2, 1, 3].map((n) => ({ n: n as 1 | 2 | 3, list: byPlace(n) })).filter((x) => x.list.length)
  const nobodyWon = !results.some((r) => r.won)

  return (
    <div className="flex flex-col gap-4 pb-8">
      <motion.h1
        className="text-center text-4xl"
        initial={{ scale: 0, rotate: -15 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 11 }}
      >
        {me ? (me.won ? 'Victoire ! 🏆' : 'Partie terminée !') : 'Résultats'}
      </motion.h1>

      {nobodyWon && <p className="text-center font-bold text-muted">Personne ne marque de point… match nul !</p>}

      {/* Podium */}
      <div className="flex items-end justify-center gap-2">
        {podium.map(({ n, list }, col) => (
          <motion.div
            key={n}
            className="flex flex-1 flex-col items-center"
            initial={{ y: 200, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.3 + (n === 1 ? 0.6 : col * 0.25), type: 'spring', stiffness: 220, damping: 15 }}
          >
            <div className="flex -space-x-6">
              {list.slice(0, 3).map((r) => {
                const p = playerOrPlaceholder(players, r.profile_id)
                return (
                  <motion.div key={r.profile_id} animate={r.won ? { y: [0, -10, 0] } : undefined} transition={{ repeat: Infinity, duration: 1.2 }}>
                    <ChibiImage slug={p.slug} tenue={p.equippedTenue} tenueBadge expression={r.won ? mood(p, n === 1 ? 'proud' : 'happy') : mood(p, 'sad')} size={n === 1 ? 96 : 76} />
                  </motion.div>
                )
              })}
            </div>
            <p className="max-w-full truncate text-center font-display text-sm font-extrabold">{list.map((r) => playerOrPlaceholder(players, r.profile_id).nickname).join(', ')}</p>
            <div className={cn('sticker flex w-full items-start justify-center rounded-b-none pt-1 text-3xl', PODIUM_H[n], n === 1 ? 'bg-sun' : n === 2 ? 'bg-sky' : 'bg-tangerine')}>
              {MEDAL[n]}
            </div>
          </motion.div>
        ))}
      </div>

      <PronosResult matchId={matchId} meId={meId} byId={players} />

      {/* Mon XP */}
      {me && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 1.2, type: 'spring', stiffness: 300, damping: 12 }}
          className="sticker flex items-center justify-between bg-grape p-4 text-white"
        >
          <div>
            <p className="text-sm font-bold opacity-90">Tes points</p>
            <p className="font-display text-3xl font-extrabold">{me.points}</p>
          </div>
          <Sparkles className="size-8" />
          <div className="text-right">
            {players[meId]?.isGuest ? (
              <p className="max-w-36 text-sm font-bold">De passage : la partie ne compte pas pour l’XP 😉</p>
            ) : (
              <>
                <p className="text-sm font-bold opacity-90">XP gagnée</p>
                <p className="font-display text-4xl font-extrabold">
                  +<CountUp to={xp} delay={1.4} />
                </p>
              </>
            )}
          </div>
        </motion.div>
      )}

      {/* Classement complet */}
      <div className="sticker flex flex-col gap-1.5 bg-surface p-3">
        {results.map((r, i) => {
          const p = playerOrPlaceholder(players, r.profile_id)
          return (
            <motion.div
              key={r.profile_id}
              initial={{ x: -60, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 1.5 + i * 0.08 }}
              className={cn('flex items-center gap-2 rounded-chip px-1 py-0.5', r.profile_id === meId && 'bg-sunk')}
            >
              <span className="w-6 text-center font-display font-extrabold">{r.placement}</span>
              <Avatar slug={p.slug} tenue={p.equippedTenue} expression={r.won ? mood(p, 'happy') : mood(p, 'sad')} size={36} />
              <span className="flex-1 font-bold">{p.nickname}</span>
              {r.won && <Badge tone="sun">Gagné</Badge>}
              <span className="w-10 text-right font-display font-extrabold">{r.points} pt</span>
              <span className="w-14 text-right text-sm font-bold text-muted">{p.isGuest ? '👋' : `+${state.xp_gained?.[r.profile_id] ?? 0} xp`}</span>
            </motion.div>
          )
        })}
      </div>

      {Summary && (
        <Suspense fallback={null}>
          <Summary state={state} meId={meId} players={players} />
        </Suspense>
      )}

      {rematch && <RematchButton matchId={matchId} game={game} meId={meId} soireeData={rematch.soireeData} resultIds={results.map((r) => r.profile_id)} onStarted={rematch.onStarted} />}

      <Button size="lg" fullWidth variant={rematch ? 'secondary' : undefined} icon={<Home className="size-6" />} onClick={onBack}>
        Retour au salon
      </Button>

      {reveal === 'expressions' && <UnlockReveal unlocks={state.new_unlocks} meId={meId} players={players} onClose={() => setReveal(hasTenues ? 'tenues' : hasTrophies ? 'trophies' : 'none')} />}
      {reveal === 'tenues' && <TenueUnlockReveal tenues={state.new_tenues} meId={meId} players={players} onClose={() => setReveal(hasTrophies ? 'trophies' : 'none')} />}
      {reveal === 'trophies' && <TrophyUnlockReveal trophies={state.new_trophies} meId={meId} players={players} onClose={() => setReveal('none')} />}
    </div>
  )
}
