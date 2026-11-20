import { useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/cn'
import { playSound } from '@/lib/feedback'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { useViewport } from '@/features/tv/tv'
import type { GamePlayProps } from '../types'
import { moverLine, rollLine, useBoardView } from './anim'
import { Stage } from './Stage'
import { CELL_INFO, cellTypesOf } from './board'
import { dedeLine } from './dede-lines'
import { MINIGAMES } from './minigames'
import { Countdown, DedeHost, DoneStrip, Scoreboard, useDeadlineTick, type Get } from './Parts'
import { AwardsScreen, Curtain, IntroScreen, MechChip, MgIntroScreen, MgResultScreen, MoveBanner, MoveCenter, useCurtain } from './Screens'
import type { DedePartyState } from './types'

/**
 * Vue télé de Dédé Party (rendue par Play sous TvContext) : lecture seule, seuls les `tick` partent.
 * Le plateau 3D en grand (caméra qui suit le pion en vedette), Dédé et sa bulle incrustés, le bandeau des scores ; pendant un mini-jeu : la règle,
 * la question ou la pluie d'étoiles, qui a répondu, puis le podium ; la cérémonie en plein écran.
 */
export function DedePartyTv({ state, act, players }: GamePlayProps) {
  const live = state as unknown as DedePartyState
  // Rideau de théâtre entre le plateau, les mini-jeux et la cérémonie : `s` = state affiché.
  const { shown: s, closed } = useCurtain(live)
  const get: Get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])
  const { w, h } = useViewport()
  const landscape = w > h * 1.05
  const left = useDeadlineTick(live, act, true)
  const view = useBoardView(s)
  const mg = s.mg
  const board = view.board
  const sad = view.events.some((e) => e.t === 'pub' || (e.t === 'riton' && e.k === 'steal')) || Boolean(view.epi?.events.some((e) => e.t === 'wash' || (e.t === 'riton' && e.k === 'steal')))

  // Sons de plateau (la télé est souvent la seule enceinte).
  const lastEv = useRef(0)
  useEffect(() => {
    const n = view.events.length
    if (n > lastEv.current) {
      const e = view.events[0]
      if (e?.t === 'star' || e?.t === 'jackpot') playSound('fanfare')
      else if (e?.t === 'pub' || e?.t === 'star_poor' || (e?.t === 'riton' && e.k === 'steal') || (e?.t === 'tp' && e.k === 'ice')) playSound('fail')
      else if (e) playSound('cash')
    }
    lastEv.current = n
  }, [view.events])
  // Épilogue du tour (marée, Riton) : un son par évènement.
  const lastEpi = useRef(0)
  const epiEvents = view.epi?.events
  useEffect(() => {
    const n = epiEvents?.length ?? 0
    if (n > lastEpi.current && epiEvents) {
      const e = epiEvents[0]
      playSound(e.t === 'wash' || (e.t === 'riton' && e.k === 'steal') ? 'fail' : 'cash')
    }
    lastEpi.current = n
  }, [epiEvents])

  // Incrustations sur le plateau 3D : en haut qui joue (ou le tour), en bas Dédé et sa bulle.
  const dede =
    s.phase === 'move'
      ? { line: moverLine(s, view, get), expression: sad ? 'pleurs' : 'joie' }
      : { line: s.phase === 'roll' ? rollLine(s) : dedeLine('mg_intro', String(s.round)), expression: 'joie' }
  const top =
    s.phase === 'move' ? (
      <MoveBanner s={s} view={view} get={get} big />
    ) : s.phase === 'roll' ? (
      <div className="flex items-center gap-3">
        <span className="sticker bg-surface/95 px-4 py-1 font-display text-4xl font-extrabold">
          Tour {s.round} / {s.rounds}
        </span>
        {s.round === s.rounds && <span className="sticker bg-tomato px-3 py-1 font-display text-3xl font-extrabold text-white">🔥 La Finale !</span>}
        <Countdown left={left} big />
        <MechChip board={board} mech={view.snap.mech} big />
      </div>
    ) : undefined
  const bottom =
    s.phase === 'move' || s.phase === 'roll' ? (
      <div className="max-w-[78%]">
        <DedeHost line={dede.line} size={104} big expression={dede.expression} />
      </div>
    ) : undefined

  // Repli sans WebGL : le contenu du milieu du plateau 2D.
  let center: React.ReactNode
  if (s.phase === 'move') {
    center = (
      <div className="flex w-full flex-col items-center gap-3">
        <MoveCenter s={s} view={view} get={get} big />
        <DedeHost line={moverLine(s, view, get)} size={110} big side="top" expression={sad ? 'pleurs' : 'joie'} />
      </div>
    )
  } else if (s.phase === 'roll') {
    center = (
      <div className="flex flex-col items-center gap-3">
        <p className="font-display text-5xl font-extrabold">
          Tour {s.round} / {s.rounds}
        </p>
        {s.round === s.rounds && <p className="sticker bg-tomato px-3 font-display text-3xl font-extrabold text-white">🔥 La Finale !</p>}
        <MechChip board={board} mech={view.snap.mech} big />
        <DedeHost line={rollLine(s)} size={140} big side="top" />
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
      return r ? `🎲 ${r.dice.join(' + ')}${r.double ? ' (Triple dé !)' : ''}` : '… lance ses dés'
    }
    if (s.phase === 'mg_play' && mg) return mg.submitted.includes(id) ? '✔ a joué' : '… joue'
    if (s.half_price[id]) return `⭐ à moitié prix !`
    return null
  }

  return (
    <div className={cn('flex h-[100dvh] w-full gap-4 overflow-hidden bg-paper p-4', landscape ? 'flex-row' : 'flex-col')}>
      <div className={cn('relative flex min-h-0 min-w-0 items-center justify-center', landscape ? 'flex-1' : 'flex-[3]')}>
        <Stage s={s} view={view} get={get} big={landscape} className="size-full" top={top} bottom={bottom} center={center} />
        <AnimatePresence mode="wait">
          {overlay && (
            <motion.div
              key={`${s.phase}:${mg?.no ?? 0}`}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="absolute inset-0 z-40 flex items-center justify-center overflow-hidden rounded-card bg-paper/90 p-6 backdrop-blur-sm"
              // Annonce du mini-jeu : le clip « échauffement » se cale sur la hauteur du panneau (unités cqh, voir MgClip).
              style={s.phase === 'mg_intro' ? { containerType: 'size' } : undefined}
            >
              <div className="max-h-full w-full max-w-5xl overflow-hidden">{overlay}</div>
            </motion.div>
          )}
        </AnimatePresence>
        <Curtain closed={closed} />
      </div>
      <div className={cn('flex min-h-0 shrink-0 flex-col gap-2 overflow-hidden', landscape ? 'w-[min(32vw,420px)]' : 'flex-[2]')}>
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 truncate font-display text-3xl font-extrabold">
            {board.emoji} {board.name}
          </span>
          <span className="sticker-sm bg-sky px-2 font-display text-xl font-extrabold text-[#1f1b2e]">
            {s.phase === 'intro' ? 'Générique' : s.phase === 'awards' ? 'Cérémonie' : `Tour ${s.round}/${s.rounds}`}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Scoreboard s={s} snap={view.snap} get={get} highlight={view.mover?.id ?? null} big note={note} />
        </div>
        {s.phase === 'move' && <MechChip board={board} mech={view.snap.mech} className="self-start" />}
        {landscape && s.players.length <= 5 && (
          <div className="grid shrink-0 grid-cols-1 gap-1">
            <p className="sticker-sm mb-1 bg-sun/30 px-2 py-1 text-sm leading-tight font-bold">
              <span className="font-display font-extrabold">✨ La particularité du plateau : </span>
              {board.rule}
            </p>
            {cellTypesOf(board).map((t) => (
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
