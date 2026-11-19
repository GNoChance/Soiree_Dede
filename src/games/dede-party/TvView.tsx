import { useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { playSound } from '@/lib/feedback'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { useViewport } from '@/features/tv/tv'
import type { GamePlayProps } from '../types'
import { moverLine, useBoardView } from './anim'
import { Board } from './GameBoard'
import { CELL_INFO, type CellType } from './board'
import { dedeLine } from './dede-lines'
import { MINIGAMES } from './minigames'
import { Countdown, DedeHost, Die, DoneStrip, Scoreboard, useDeadlineTick, type Get } from './Parts'
import { AwardsScreen, IntroScreen, MgIntroScreen, MgResultScreen, MoveCenter } from './Screens'
import type { DedePartyState } from './types'

/**
 * Vue télé de Dédé Party (rendue par Play sous TvContext) : lecture seule, seuls les `tick` partent.
 * Le plateau en grand avec Dédé au centre, le bandeau des scores ; pendant un mini-jeu : la règle,
 * la question ou la pluie d'étoiles, qui a répondu, puis le podium ; la cérémonie en plein écran.
 */
export function DedePartyTv({ state, act, players }: GamePlayProps) {
  const s = state as unknown as DedePartyState
  const get: Get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  const { w, h } = useViewport()
  const landscape = w > h * 1.05
  const left = useDeadlineTick(s, act, true)
  const view = useBoardView(s)
  const mg = s.mg

  // Sons de plateau (la télé est souvent la seule enceinte).
  const lastEv = useRef(0)
  useEffect(() => {
    const n = view.events.length
    if (n > lastEv.current) {
      const e = view.events[0]
      if (e?.t === 'star') playSound('fanfare')
      else if (e?.t === 'pub' || e?.t === 'star_poor') playSound('fail')
      else if (e) playSound('cash')
    }
    lastEv.current = n
  }, [view.events])

  let center: React.ReactNode
  if (s.phase === 'move') {
    center = (
      <div className="flex w-full flex-col items-center gap-3">
        <MoveCenter s={s} view={view} get={get} big />
        <DedeHost line={moverLine(s, view, get)} size={110} big side="top" expression={view.events.some((e) => e.t === 'pub') ? 'pleurs' : 'joie'} />
      </div>
    )
  } else if (s.phase === 'roll') {
    center = (
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-5xl font-extrabold">
          Tour {s.round} / {s.rounds}
        </p>
        {s.round === s.rounds && <p className="sticker bg-tomato px-3 font-display text-3xl font-extrabold text-white">🔥 La Finale !</p>}
        <DedeHost line={s.round === s.rounds ? dedeLine('finale', String(s.round)) : dedeLine('roll', String(s.round))} size={140} big side="top" />
        <Countdown left={left} big />
      </div>
    )
  } else {
    center = <DedeHost line={dedeLine('mg_intro', String(s.round))} size={150} big side="top" />
  }

  // Panneau plein cadre (générique, mini-jeu, cérémonie) par-dessus le plateau.
  let overlay: React.ReactNode = null
  if (s.phase === 'intro') overlay = <IntroScreen s={s} get={get} big />
  else if (s.phase === 'mg_intro' && mg) overlay = <MgIntroScreen s={s} mg={mg} big />
  else if (s.phase === 'mg_play' && mg) {
    const def = MINIGAMES[mg.kind]
    const Tv = def.Tv
    overlay = (
      <div className="flex w-full flex-col items-center gap-3">
        <div className="sticker flex items-center gap-3 px-5 py-2 text-[#1f1b2e]" style={{ background: def.color }}>
          <span className="text-5xl">{def.emoji}</span>
          <span className="font-display text-4xl font-extrabold">{def.name}</span>
          {mg.finale && <span className="sticker-sm bg-tomato px-2 font-display text-2xl font-extrabold text-white">×2</span>}
        </div>
        {Tv ? <Tv s={s} mg={mg} get={get} /> : <DoneStrip ids={s.players} done={mg.submitted} get={get} size={64} />}
      </div>
    )
  } else if (s.phase === 'mg_result' && mg) overlay = <MgResultScreen mg={mg} get={get} big />
  else if (s.phase === 'awards') overlay = <AwardsScreen s={s} get={get} big />

  const note = (id: string) => {
    if (s.phase === 'roll') {
      const r = s.rolls[id]
      return r ? `🎲 ${r.dice.join(' + ')}${r.double ? ' (Double dé !)' : ''}` : '… lance son dé'
    }
    if (s.phase === 'mg_play' && mg) return mg.submitted.includes(id) ? '✔ a joué' : '… joue'
    if (s.half_price[id]) return `Étoile à moitié prix !`
    return null
  }

  return (
    <div className={cn('flex h-[100dvh] w-full gap-4 overflow-hidden bg-paper p-4', landscape ? 'flex-row' : 'flex-col')}>
      <div className={cn('relative flex min-h-0 min-w-0 items-center justify-center', landscape ? 'flex-1' : 'flex-[3]')}>
        <div className={cn('aspect-square', landscape ? 'h-full max-w-full' : 'w-full max-h-full')}>
          <Board s={s} view={view} get={get} center={center} />
        </div>
        <AnimatePresence mode="wait">
          {overlay && (
            <motion.div
              key={`${s.phase}:${mg?.no ?? 0}`}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden rounded-card bg-paper/90 p-6 backdrop-blur-sm"
            >
              <div className="max-h-full w-full max-w-5xl overflow-hidden">{overlay}</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className={cn('flex min-h-0 shrink-0 flex-col gap-2 overflow-hidden', landscape ? 'w-[min(32vw,420px)]' : 'flex-[2]')}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-display text-3xl font-extrabold">🎤 Dédé Party</span>
          <span className="sticker-sm bg-sky px-2 font-display text-xl font-extrabold text-[#1f1b2e]">
            {s.phase === 'intro' ? 'Générique' : s.phase === 'awards' ? 'Cérémonie' : `Tour ${s.round}/${s.rounds}`}
          </span>
        </div>
        {s.phase === 'roll' && (
          <div className="flex flex-wrap items-center gap-2">
            {s.order.map((id) => {
              const r = s.rolls[id]
              return r ? (
                <motion.div key={id} initial={{ scale: 0 }} animate={{ scale: 1 }} className="flex gap-0.5">
                  {r.dice.map((d, i) => (
                    <Die key={i} value={d} size={34} />
                  ))}
                </motion.div>
              ) : null
            })}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-hidden">
          <Scoreboard s={s} snap={view.snap} get={get} highlight={view.mover?.id ?? null} big note={note} />
        </div>
        {landscape && s.players.length <= 6 && (
          <div className="grid shrink-0 grid-cols-1 gap-1">
            {(Object.keys(CELL_INFO) as CellType[]).map((t) => (
              <div key={t} className="flex items-center gap-2 text-sm leading-tight font-bold">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border-2 border-ink text-base" style={{ background: CELL_INFO[t].color }}>
                  {CELL_INFO[t].emoji}
                </span>
                <span>
                  <span className="font-display font-extrabold">{CELL_INFO[t].label}</span> <span className="text-muted">· {CELL_INFO[t].effect}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
