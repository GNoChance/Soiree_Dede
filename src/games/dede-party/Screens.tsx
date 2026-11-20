import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { victoryConfetti } from '@/components/ui/confetti'
import { cn } from '@/lib/cn'
import { playSound } from '@/lib/feedback'
import { mood } from '@/features/soiree/players'
import { useCountdown } from '@/features/soiree/useServerClock'
import { withUnit } from '../le-plus-proche/setup'
import { dedeLine } from './dede-lines'
import { MG_ORDER, MINIGAMES } from './minigames'
import { fmtSec } from './minigames/common'
import { eventLabel, mechChip, type BoardView, type EpiView } from './anim'
import { boardOf, type BoardDef } from './board'
import { DedeHost, Die, type Get } from './Parts'
import { RITON_DIE_MS, WASH_AT_MS, type DedePartyState, type DpMech, type DpMg, type DpMgResult } from './types'

/** Générique : « Bienvenue dans Dédé Party ! », le plateau du soir et sa mécanique, les candidats. */
export function IntroScreen({ s, get, big }: { s: DedePartyState; get: Get; big?: boolean }) {
  const b = boardOf(s.map)
  return (
    <div className={cn('flex flex-col items-center text-center', big ? 'gap-4' : 'gap-3')}>
      <motion.h2
        initial={{ scale: 3, rotate: -15, opacity: 0 }}
        animate={{ scale: 1, rotate: -3, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 12 }}
        className={cn('sticker bg-sun px-5 py-2 font-display font-extrabold text-[#1f1b2e]', big ? 'text-7xl' : 'text-4xl')}
        style={{ boxShadow: '8px 8px 0 0 var(--ink)' }}
      >
        🎤 Dédé Party !
      </motion.h2>
      <motion.div
        initial={{ y: 40, opacity: 0, rotate: 4 }}
        animate={{ y: 0, opacity: 1, rotate: 1 }}
        transition={{ delay: 0.35, type: 'spring', stiffness: 260, damping: 14 }}
        className={cn('sticker flex max-w-full flex-col items-center gap-1 bg-surface', big ? 'px-6 py-3' : 'px-3 py-2')}
      >
        <span className={cn('font-display font-extrabold leading-tight', big ? 'text-5xl' : 'text-2xl')}>
          Ce soir : {b.emoji} {b.name}
        </span>
        <span className={cn('font-bold leading-snug', big ? 'text-2xl' : 'text-sm')}>{b.rule}</span>
      </motion.div>
      <DedeHost line={s.map ? dedeLine(`map_${b.id}` as const, String(s.players.length)) : dedeLine('intro', String(s.players.length))} size={big ? 150 : 80} big={big} expression="joie" />
      <div className="flex flex-wrap justify-center gap-3">
        {s.order.map((id, i) => {
          const p = get(id)
          return (
            <motion.div key={id} initial={{ y: 60, opacity: 0, scale: 0.4 }} animate={{ y: 0, opacity: 1, scale: 1 }} transition={{ delay: 0.5 + i * 0.25, type: 'spring', stiffness: 300, damping: 14 }} className="flex flex-col items-center">
              <Avatar slug={p.slug} tenue={p.equippedTenue} expression={mood(p, 'happy')} size={big ? 96 : 56} bounce />
              <span className={cn('font-display font-extrabold', big ? 'text-2xl' : 'text-sm')}>{p.nickname}</span>
            </motion.div>
          )
        })}
      </div>
      <p className={cn('font-bold text-muted', big ? 'text-2xl' : 'text-sm')}>
        {s.rounds} tours · le plus d’étoiles ⭐ gagne · 30 🪙 = 1 étoile (la 1re à 15 !)
      </p>
    </div>
  )
}

/** Annonce du mini-jeu (8 s) : roulette, nom, une phrase de règle, 3-2-1. */
export function MgIntroScreen({ s, mg, big }: { s: DedePartyState; mg: DpMg; big?: boolean }) {
  const left = useCountdown(s.deadline)
  const spun = left < 5600
  const [face, setFace] = useState(0)
  useEffect(() => {
    if (spun) return
    const id = window.setInterval(() => setFace((f) => (f + 1) % MG_ORDER.length), 120)
    return () => clearInterval(id)
  }, [spun])
  const landed = useRef(false)
  useEffect(() => {
    if (spun && !landed.current) {
      landed.current = true
      playSound('fanfare')
    }
  }, [spun])
  const def = MINIGAMES[mg.kind]
  const shown = spun ? def : MINIGAMES[MG_ORDER[face]]
  const sec = Math.ceil(left / 1000)
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      {mg.finale && (
        <motion.span initial={{ scale: 0 }} animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 0.9 }} className={cn('sticker bg-tomato px-3 py-1 font-display font-extrabold text-white', big ? 'text-4xl' : 'text-xl')}>
          🔥 LA FINALE : gains doublés !
        </motion.span>
      )}
      <p className={cn('font-display font-extrabold text-muted', big ? 'text-3xl' : 'text-lg')}>Mini-jeu n°{mg.no}</p>
      <motion.div
        key={spun ? 'final' : face}
        initial={spun ? { scale: 0.3, rotate: -20 } : { y: -20, opacity: 0.4 }}
        animate={spun ? { scale: 1, rotate: -2 } : { y: 0, opacity: 1 }}
        transition={spun ? { type: 'spring', stiffness: 300, damping: 11 } : { duration: 0.1 }}
        className={cn('sticker flex flex-col items-center gap-1 px-6 py-4 text-[#1f1b2e]', big ? 'min-w-[560px]' : 'w-full')}
        style={{ background: shown.color, boxShadow: '8px 8px 0 0 var(--ink)' }}
      >
        <span className={big ? 'text-9xl' : 'text-7xl'}>{shown.emoji}</span>
        <span className={cn('font-display font-extrabold leading-tight', big ? 'text-6xl' : 'text-3xl')}>{shown.name}</span>
      </motion.div>
      {spun && (
        <motion.p initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={cn('sticker bg-surface px-4 py-2 font-display font-extrabold', big ? 'text-4xl' : 'text-xl')}>
          {def.rule}
        </motion.p>
      )}
      <AnimatePresence mode="popLayout">
        {sec <= 3 && sec > 0 && (
          <motion.span key={sec} initial={{ scale: 2.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className={cn('font-display font-extrabold text-tangerine', big ? 'text-9xl' : 'text-7xl')}>
            {sec}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Détail du score d'un joueur selon le mini-jeu. */
export function scoreDetail(mg: DpMg, r: DpMgResult, get: Get): string {
  if (!r.played) return 'pas joué'
  switch (mg.kind) {
    case 'quiz':
      return `${r.score}/3 bonne${Number(r.score) > 1 ? 's' : ''}${typeof r.ms === 'number' ? ` · ${fmtSec(r.ms, 1)}` : ''}`
    case 'pif':
      return withUnit(Number(r.score), (mg.reveal?.unit as string | null) ?? null)
    case 'majorite':
      return `a voté ${get(String(r.score)).nickname}`
    case 'buzzer':
      return r.false_start ? 'faux départ 😬' : fmtSec(Number(r.score), 3)
    case 'etoiles':
      return `${r.score} ⭐`
    case 'chrono':
      return fmtSec(Number(r.score))
  }
}

/** Ce que le résultat révèle (réponse, majorité…). */
function RevealLine({ mg, get, big }: { mg: DpMg; get: Get; big?: boolean }) {
  const rv = mg.reveal ?? {}
  const cls = cn('sticker bg-surface px-3 py-2 text-center font-display font-extrabold', big ? 'text-3xl' : 'text-base')
  if (mg.kind === 'pif') return <p className={cls}>Réponse : {withUnit(Number(rv.answer), (rv.unit as string | null) ?? null)}</p>
  if (mg.kind === 'chrono') return <p className={cls}>Objectif : 7,00 s</p>
  if (mg.kind === 'majorite') {
    const top = (rv.top as string[] | undefined) ?? []
    const counts = (rv.counts as Record<string, number> | undefined) ?? {}
    if (!top.length) return <p className={cls}>Personne n’a voté !</p>
    return (
      <p className={cls}>
        La majorité a désigné {top.map((id) => get(id).nickname).join(' et ')} ({counts[top[0]]} vote{counts[top[0]] > 1 ? 's' : ''})
      </p>
    )
  }
  if (mg.kind === 'quiz') {
    const qs = (mg.data.questions as Array<{ prompt: string; choices: string[] }>) ?? []
    const ans = (rv.answers as number[] | undefined) ?? []
    return (
      <div className={cn('sticker flex flex-col gap-1 bg-surface px-3 py-2 text-left', big ? 'text-2xl' : 'text-sm')}>
        {qs.map((q, i) => (
          <p key={i} className="leading-tight">
            <span className="font-bold text-muted">{q.prompt}</span> <span className="font-display font-extrabold">→ {q.choices[ans[i]]}</span>
          </p>
        ))}
      </div>
    )
  }
  return null
}

const MEDAL = ['🥇', '🥈', '🥉']

/** Résultats du mini-jeu (8 s) : podium, pièces gagnées. */
export function MgResultScreen({ mg, get, meId, big }: { mg: DpMg; get: Get; meId?: string; big?: boolean }) {
  const rows = mg.results ?? []
  const winners = rows.filter((r) => r.rank === 1)
  const winName = winners.length > 3 ? `${winners.length} gagnants` : winners.map((r) => get(r.id).nickname).join(' et ')
  const def = MINIGAMES[mg.kind]
  useEffect(() => {
    playSound('cash')
  }, [])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-center gap-2 text-center">
        <span className={big ? 'text-6xl' : 'text-4xl'}>{def.emoji}</span>
        <span className={cn('font-display font-extrabold', big ? 'text-5xl' : 'text-2xl')}>{def.name}</span>
      </div>
      <RevealLine mg={mg} get={get} big={big} />
      {winners.length > 0 && <DedeHost line={dedeLine('mg_result', `${mg.no}`, winName)} size={big ? 110 : 64} big={big} expression="surprise" />}
      <div className="flex flex-col gap-1.5">
        {rows.map((r, i) => {
          const p = get(r.id)
          return (
            <motion.div
              key={r.id}
              initial={{ x: -40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.2 + i * 0.12 }}
              className={cn('sticker-sm flex items-center gap-2 px-2 py-1', r.rank === 1 ? 'bg-sun text-[#1f1b2e]' : r.id === meId ? 'bg-sky/25' : 'bg-surface', !r.played && 'opacity-60')}
            >
              <span className={cn('w-9 text-center font-display font-extrabold', big ? 'text-4xl' : 'text-2xl')}>{r.rank && r.rank <= 3 ? MEDAL[r.rank - 1] : (r.rank ?? '–')}</span>
              <Avatar slug={p.slug} tenue={p.equippedTenue} expression={mood(p, r.rank === 1 ? 'proud' : r.played ? 'happy' : 'sleepy')} size={big ? 56 : 38} />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className={cn('truncate font-extrabold', big ? 'text-2xl' : 'text-base')}>{p.nickname}</span>
                <span className={cn('truncate font-bold opacity-75', big ? 'text-lg' : 'text-xs')}>{scoreDetail(mg, r, get)}</span>
              </div>
              <span className={cn('font-display font-extrabold tabular-nums', big ? 'text-4xl' : 'text-2xl')}>+{r.coins} 🪙</span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

/** Cérémonie (12 s) : roulement de tambour, les 2 étoiles bonus une par une, puis le classement final. */
export function AwardsScreen({ s, get, big }: { s: DedePartyState; get: Get; big?: boolean }) {
  const left = useCountdown(s.deadline)
  const t = 12000 - left
  const step = t < 1500 ? 0 : t < 5000 ? 1 : t < 8500 ? 2 : 3
  const fired = useRef(false)
  useEffect(() => {
    if (step === 1 || step === 2) playSound('fanfare')
    if (step === 3 && !fired.current) {
      fired.current = true
      victoryConfetti(2500)
    }
  }, [step])
  const awards = s.awards ?? []
  const ranking = s.ranking ?? []
  const winners = ranking.filter((r) => r.rank === 1)
  const dense = Boolean(big) && ranking.length > 4
  const AW = {
    king: { title: 'Roi des mini-jeux', emoji: '👑', unit: (n: number) => `${n} mini-jeu${n > 1 ? 'x' : ''} gagné${n > 1 ? 's' : ''}` },
    poisse: { title: 'Prix de la poisse', emoji: '📺', unit: (n: number) => `${n} page${n > 1 ? 's' : ''} de pub` },
  }
  const line =
    step === 0
      ? 'Roulement de tambour… place à la cérémonie des étoiles bonus !'
      : step === 3
        ? winners.length > 1
          ? dedeLine('tie', String(s.round))
          : dedeLine('winner', String(s.round), winners[0] ? get(winners[0].id).nickname : '')
        : (() => {
            const a = awards[step - 1]
            if (!a || !a.ids.length) return `${AW[a?.kind ?? 'king'].title} : personne cette fois !`
            return dedeLine(a.kind, String(s.round), a.ids.map((id) => get(id).nickname).join(' et '))
          })()

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <DedeHost line={line} size={big ? 140 : 80} big={big} expression={step === 3 ? 'cool' : 'surprise'} />
      {step === 0 && (
        <motion.span animate={{ rotate: [-10, 10, -10], scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 0.25 }} className={big ? 'text-9xl' : 'text-7xl'}>
          🥁
        </motion.span>
      )}
      {step === 3 && (
        <div className="flex flex-wrap justify-center gap-2">
          {awards.map((a) =>
            a.ids.length ? (
              <span key={a.kind} className={cn('sticker-sm bg-sun px-2 py-0.5 font-display font-extrabold text-[#1f1b2e]', big ? 'text-2xl' : 'text-sm')}>
                {AW[a.kind].emoji} ⭐ {AW[a.kind].title} : {a.ids.map((id) => get(id).nickname).join(', ')}
              </span>
            ) : null,
          )}
        </div>
      )}
      <div className={cn('grid w-full gap-2', big ? 'grid-cols-2' : 'grid-cols-1', step === 3 && 'hidden')}>
        {awards.slice(0, Math.min(2, step)).map((a) => (
          <motion.div key={a.kind} initial={{ scale: 0.3, rotate: -10 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 12 }} className="sticker flex flex-col items-center gap-1 bg-sun p-3 text-[#1f1b2e]">
            <span className={cn('font-display font-extrabold', big ? 'text-4xl' : 'text-xl')}>
              {AW[a.kind].emoji} ⭐ {AW[a.kind].title}
            </span>
            {a.ids.length ? (
              <div className="flex flex-wrap justify-center gap-2">
                {a.ids.map((id) => (
                  <div key={id} className="flex flex-col items-center">
                    <Avatar slug={get(id).slug} tenue={get(id).equippedTenue} expression={mood(get(id), a.kind === 'king' ? 'proud' : 'sad')} size={big ? 90 : 56} bounce />
                    <span className="font-display font-extrabold">{get(id).nickname}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="font-bold">Personne</span>
            )}
            <span className="text-sm font-bold opacity-75">{a.ids.length ? AW[a.kind].unit(a.value) : ''}</span>
          </motion.div>
        ))}
      </div>
      {step === 3 && (
        <div className={cn('grid w-full gap-1.5', dense ? 'grid-cols-2' : 'grid-cols-1')}>
          {ranking.map((r, i) => {
            const p = get(r.id)
            return (
              <motion.div key={r.id} initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: i * 0.15 }} className={cn('sticker-sm flex items-center gap-2 px-2 py-1', r.rank === 1 ? 'bg-sun text-[#1f1b2e]' : 'bg-surface')}>
                <span className={cn('w-9 font-display font-extrabold', big ? 'text-4xl' : 'text-2xl')}>{r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>
                <Avatar slug={p.slug} tenue={p.equippedTenue} expression={mood(p, r.rank === 1 ? 'proud' : 'happy')} size={big ? (dense ? 48 : 60) : 40} bounce={r.rank === 1} />
                <span className={cn('min-w-0 flex-1 truncate text-left font-extrabold', big ? (dense ? 'text-2xl' : 'text-3xl') : 'text-lg')}>{p.nickname}</span>
                <span className={cn('font-display font-extrabold tabular-nums', big ? (dense ? 'text-2xl' : 'text-3xl') : 'text-lg')}>
                  ⭐ {r.stars} · 🪙 {r.coins}
                </span>
              </motion.div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Puce de la mécanique du plateau (à côté du tour en cours) : marée, cagnotte, sac de Riton. */
export function MechChip({ board, mech, big, className }: { board: BoardDef; mech: DpMech | undefined; big?: boolean; className?: string }) {
  const chip = mechChip(board, mech)
  if (!chip) return null
  return (
    <motion.span
      key={chip.text}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={chip.alert ? { scale: [1, 1.07, 1], opacity: 1 } : { scale: 1, opacity: 1 }}
      transition={chip.alert ? { scale: { repeat: Infinity, duration: 0.9 } } : { type: 'spring', stiffness: 320, damping: 16 }}
      className={cn('sticker-sm inline-block px-2 py-0.5 text-center font-display font-extrabold leading-tight', chip.alert ? 'bg-tomato text-white' : 'bg-surface/95', big ? 'text-2xl' : 'text-sm', className)}
    >
      {chip.text}
    </motion.span>
  )
}

/** Titre et détail de l'épilogue du tour (marée, ronde de Riton). */
function epiText(epi: EpiView, get: Get): { title: string; detail: string | null } {
  const d = epi.data
  if (d.t === 'tide') {
    if (d.tide === 0) return { title: '🏝️ Marée basse : le Banc de sable rouvre !', detail: null }
    const washed = epi.events.filter((e) => e.t === 'wash')
    return {
      title: '🌊 La mer monte !',
      detail: washed.length ? washed.map((e) => `${get(e.id ?? '').nickname} −${-(e.d ?? 0)} 🪙`).join(' · ') : epi.t >= WASH_AT_MS ? 'Personne à la baille !' : null,
    }
  }
  const last = epi.events[0]
  return {
    title: `🦝 La ronde de Riton${epi.t >= RITON_DIE_MS ? ` : 🎲 ${d.die}` : '…'}`,
    detail: last ? `${get(last.id ?? '').nickname} : ${eventLabel(last, (id) => get(id).nickname)}` : null,
  }
}

/** Au centre du plateau pendant les déplacements : le pion en vedette, ses dés, le dernier évènement. */
export function MoveCenter({ s, view, get, big }: { s: DedePartyState; view: BoardView; get: Get; big?: boolean }) {
  const m = view.mover
  if (!m && view.epi) {
    const e = epiText(view.epi, get)
    return (
      <div className="flex w-full flex-col items-center gap-1.5 text-center">
        <span className={cn('font-display font-extrabold leading-tight', big ? 'text-4xl' : 'text-lg')}>{e.title}</span>
        {e.detail && <span className={cn('sticker-sm bg-sun px-2 py-1 font-display font-extrabold leading-tight text-[#1f1b2e]', big ? 'text-2xl' : 'text-sm')}>{e.detail}</span>}
      </div>
    )
  }
  if (!m) {
    return <p className={cn('text-center font-display font-extrabold text-muted', big ? 'text-3xl' : 'text-base')}>{view.done ? 'Tout le monde a bougé !' : 'Les pions se mettent en place…'}</p>
  }
  const p = get(m.id)
  const last = view.events[0]
  const idx = s.moves.findIndex((x) => x.id === m.id)
  return (
    <div className="flex w-full flex-col items-center gap-1.5 text-center">
      <span className={cn('font-display font-extrabold text-muted', big ? 'text-2xl' : 'text-xs')}>
        Pion {idx + 1} / {s.moves.length}
      </span>
      <span className={cn('font-display font-extrabold leading-tight', big ? 'text-4xl' : 'text-lg')}>C’est à {p.nickname} !</span>
      <div className="flex gap-1.5">
        {m.dice.map((d, i) => (
          <Die key={`${m.id}${i}`} value={d} size={big ? 72 : 40} />
        ))}
      </div>
      <AnimatePresence mode="popLayout">
        {last && (
          <motion.span
            key={view.events.length}
            initial={{ scale: 0.4, rotate: -6, opacity: 0 }}
            animate={{ scale: 1, rotate: -2, opacity: 1 }}
            className={cn('sticker-sm bg-sun px-2 py-1 font-display font-extrabold leading-tight text-[#1f1b2e]', big ? 'text-2xl' : 'text-sm')}
          >
            {eventLabel(last, (id) => get(id).nickname, view.board)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Bandeau incrusté sur le plateau 3D : qui joue, ses dés, ce qui vient d'arriver (ou l'épilogue du tour). */
export function MoveBanner({ s, view, get, big }: { s: DedePartyState; view: BoardView; get: Get; big?: boolean }) {
  const m = view.mover
  if (!m && view.epi) {
    const e = epiText(view.epi, get)
    return (
      <div className="flex max-w-full flex-col items-center gap-1.5">
        <motion.span
          key={view.epi.data.t}
          initial={{ y: -30, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={cn('sticker-sm bg-surface/95 px-3 py-1 text-center font-display font-extrabold leading-tight', big ? 'text-4xl' : 'text-lg')}
        >
          {e.title}
        </motion.span>
        <AnimatePresence mode="popLayout">
          {e.detail && (
            <motion.span
              key={e.detail}
              initial={{ scale: 0.4, rotate: -6, opacity: 0 }}
              animate={{ scale: 1, rotate: -1.5, opacity: 1 }}
              exit={{ opacity: 0 }}
              className={cn('sticker-sm max-w-full bg-sun px-2 py-1 text-center font-display font-extrabold leading-tight text-[#1f1b2e]', big ? 'text-3xl' : 'text-sm')}
            >
              {e.detail}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    )
  }
  if (!m) {
    return (
      <span className={cn('sticker-sm bg-surface/95 px-3 py-1 text-center font-display font-extrabold', big ? 'text-3xl' : 'text-base')}>
        {view.done ? 'Tout le monde a bougé !' : 'Les pions se mettent en place…'}
      </span>
    )
  }
  const p = get(m.id)
  const last = view.events[0]
  const total = m.dice.reduce((a, b) => a + b, 0)
  return (
    <div className="flex max-w-full flex-col items-center gap-1.5">
      <motion.div key={m.id} initial={{ y: -30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 22 }} className={cn('sticker-sm flex items-center bg-surface/95 font-display font-extrabold leading-none', big ? 'gap-3 px-4 py-2 text-4xl' : 'gap-2 px-2.5 py-1 text-lg')}>
        <Avatar slug={p.slug} tenue={p.equippedTenue} size={big ? 64 : 34} />
        <span className="min-w-0 truncate">{p.nickname}</span>
        <span className={cn('flex items-center', big ? 'gap-1.5' : 'gap-1')}>
          {m.dice.map((d, i) => (
            <Die key={`${m.id}${i}`} value={m.rolling ? null : d} rolling={m.rolling} size={big ? 46 : 26} className={big ? undefined : 'border-2 shadow-none'} />
          ))}
        </span>
        {!m.rolling && <span className="tabular-nums">= {total}</span>}
        <span className={cn('text-muted', big ? 'text-2xl' : 'text-xs')}>
          {s.moves.findIndex((x) => x.id === m.id) + 1}/{s.moves.length}
        </span>
      </motion.div>
      <AnimatePresence mode="popLayout">
        {last && (
          <motion.span
            key={`${m.id}${view.events.length}`}
            initial={{ scale: 0.4, rotate: -6, opacity: 0 }}
            animate={{ scale: 1, rotate: -1.5, opacity: 1 }}
            exit={{ opacity: 0 }}
            className={cn('sticker-sm max-w-full bg-sun px-2 py-1 text-center font-display font-extrabold leading-tight text-[#1f1b2e]', big ? 'text-3xl' : 'text-sm')}
          >
            {eventLabel(last, (id) => get(id).nickname, view.board)}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Grandes familles d'écrans : le rideau passe quand on change de famille. */
const actOf = (s: DedePartyState) => (s.phase === 'roll' || s.phase === 'move' ? 'board' : s.phase.startsWith('mg') ? `mg${s.mg?.no ?? 0}` : s.phase)

/**
 * Transition « rideau de théâtre » entre le plateau, les mini-jeux et la cérémonie : le state affiché
 * est retenu le temps que le rideau se ferme, puis remplacé derrière lui. `shown` = state à afficher,
 * `closed` = rideau fermé (à passer à <Curtain />).
 */
export function useCurtain(s: DedePartyState): { shown: DedePartyState; closed: boolean } {
  const act = actOf(s)
  const [held, setHeld] = useState({ act, s })
  const latest = useRef(s)
  useEffect(() => {
    latest.current = s
  }, [s])
  useEffect(() => {
    if (held.act === act) return
    playSound('whoosh')
    const t = window.setTimeout(() => setHeld({ act, s: latest.current }), 420)
    return () => clearTimeout(t)
  }, [act, held.act])
  const closed = held.act !== act
  return { shown: closed ? held.s : s, closed }
}

/** Les deux pans du rideau rouge (plein cadre du parent `relative`, ou plein écran avec `fixed`). */
export function Curtain({ closed, fixed }: { closed: boolean; fixed?: boolean }) {
  const pane = (side: 'left' | 'right') => (
    <motion.div
      key={side}
      initial={{ x: side === 'left' ? '-102%' : '102%' }}
      animate={{ x: 0 }}
      exit={{ x: side === 'left' ? '-102%' : '102%' }}
      transition={{ duration: 0.36, ease: [0.3, 0.9, 0.4, 1] }}
      className={cn('absolute inset-y-0 w-1/2 border-ink', side === 'left' ? 'left-0 border-r-4' : 'right-0 border-l-4')}
      style={{ background: 'repeating-linear-gradient(90deg, #d62839 0 18px, #a4133c 18px 30px, #c1121f 30px 44px)', boxShadow: 'inset 0 -18px 0 0 #FFD23F, inset 0 -22px 0 0 #1f1b2e' }}
    />
  )
  return (
    <div className={cn('pointer-events-none inset-0 z-50 overflow-hidden', fixed ? 'fixed' : 'absolute rounded-card')} aria-hidden>
      <AnimatePresence>{closed && [pane('left'), pane('right')]}</AnimatePresence>
      <AnimatePresence>
        {closed && (
          <motion.div key="logo" initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: -4 }} exit={{ scale: 0, opacity: 0 }} transition={{ delay: 0.12, type: 'spring', stiffness: 320, damping: 16 }} className="absolute inset-0 flex items-center justify-center">
            <span className="sticker bg-sun px-4 py-1 font-display text-4xl font-extrabold text-[#1f1b2e]">🎤 Dédé Party</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
