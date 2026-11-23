import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { Avatar } from '@/components/ui/Avatar'
import { burst, burstFrom } from '@/components/ui/confetti'
import { cn } from '@/lib/cn'
import { mood } from '@/features/soiree/players'
import { useViewport } from '@/features/tv/tv'
import { TvAnswered, TvNextIn, TvScores, TvTimer, vh, type TvGet } from '../qui-de-nous/TvParts'
import { tpFlyOrder } from './revealOrder'
import { percents } from './setup'
import type { TpDilemma, TpReveal, TpState } from './types'

/**
 * Vue télé de « Tu préfères ? » (rendue par Play sous TvContext) : lecture seule.
 * Phase de réponse : seuls `s.dilemma` et `s.answered` (qui a répondu, jamais quoi) sont lus.
 * Les choix / paris ne sont lus que dans `s.last_reveal` (public seulement à la révélation).
 */

const SIDES = ['a', 'b'] as const
const SIDE = {
  a: { letter: 'A', bg: 'bg-tomato', text: 'text-white', hex: '#EF476F', tilt: -2 },
  b: { letter: 'B', bg: 'bg-sky', text: 'text-[#1f1b2e]', hex: '#4CC9F0', tilt: 2 },
} as const

/** Taille de police (en vh) adaptée à la longueur du dilemme. */
const fontFor = (txt: string, big: number) => (txt.length > 90 ? big * 0.62 : txt.length > 55 ? big * 0.78 : big)

export function TuPreferesTv({ s, get }: { s: TpState; get: TvGet }) {
  return (
    <div className="relative flex h-full flex-col overflow-hidden" style={{ gap: vh(1.6), padding: vh(2) }}>
      {s.phase === 'answering' && s.dilemma && <TvAnswering key={`q${s.round}`} s={s} d={s.dilemma} get={get} />}
      {s.phase === 'reveal' && s.last_reveal && <TvReveal key={`r${s.last_reveal.round}`} s={s} lr={s.last_reveal} get={get} />}
    </div>
  )
}

function TvAnswering({ s, d, get }: { s: TpState; d: TpDilemma; get: TvGet }) {
  const reduce = useReducedMotion()
  return (
    <>
      <TvTimer deadline={s.deadline} totalMs={s.timer * 1000} />
      <div className="relative grid min-h-0 flex-1 grid-cols-2" style={{ gap: vh(3) }}>
        {SIDES.map((side, i) => (
          <motion.div
            key={side}
            initial={reduce ? false : { x: side === 'a' ? -200 : 200, opacity: 0, rotate: SIDE[side].tilt * 4 }}
            animate={{ x: 0, opacity: 1, rotate: SIDE[side].tilt }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: i * 0.1 }}
            className={cn('sticker relative flex flex-col items-center justify-center text-center hyphens-auto', SIDE[side].bg, SIDE[side].text)}
            style={{ padding: vh(2.5), gap: vh(1) }}
          >
            <span className="font-display font-extrabold opacity-80" style={{ fontSize: vh(7) }}>
              {SIDE[side].letter}
            </span>
            <p lang="fr" className="font-display leading-tight font-extrabold break-words" style={{ fontSize: vh(fontFor(d[side], 6.2)) }}>
              {d[side]}
            </p>
          </motion.div>
        ))}
        <span
          className="absolute top-1/2 left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[0.6vh] border-ink bg-sun font-display font-extrabold text-[#1f1b2e] shadow-sticker"
          style={{ width: vh(12), height: vh(12), fontSize: vh(5) }}
        >
          OU
        </span>
      </div>
      <p className="text-center font-display font-extrabold" style={{ fontSize: vh(3.4) }}>
        {s.answered.length >= s.players.length ? 'Tout le monde a répondu !' : 'Chacun choisit sur son téléphone…'}
      </p>
      <TvAnswered ids={s.players} done={s.answered} get={get} size={10} />
    </>
  )
}

const SPLIT_STEP = 1
const FLY_STEP = 2

function TvReveal({ s, lr, get }: { s: TpState; lr: TpReveal; get: TvGet }) {
  const reduce = useReducedMotion()
  const { h } = useViewport()
  const [order] = useState(() => tpFlyOrder(lr))
  const end = FLY_STEP + order.length
  const [step, setStep] = useState(reduce ? end : 0)
  const done = step >= end
  const flown = Math.max(0, Math.min(order.length, step - FLY_STEP))

  useEffect(() => {
    if (done) return
    const delay = step === 0 ? 1000 : step === SPLIT_STEP ? 1100 : Math.max(200, 420 - (step - FLY_STEP) * 30)
    const t = window.setTimeout(() => setStep((n) => n + 1), delay)
    return () => clearTimeout(t)
  }, [step, done])

  const majRef = useRef<HTMLDivElement>(null)
  const celebrated = useRef(false)
  useEffect(() => {
    if (!done || celebrated.current) return
    celebrated.current = true
    if (lr.majority) {
      if (majRef.current) burstFrom(majRef.current, 120)
      else burst({ x: 0.5, y: 0.4 }, 120)
    }
  }, [done, lr])

  const pct = percents(lr.counts)
  const total = lr.counts.a + lr.counts.b
  const split = step >= SPLIT_STEP
  const placed = new Set(order.slice(0, flown))
  const pool = order.filter((id) => !placed.has(id))
  const silent = s.players.filter((id) => !(id in lr.choices))
  const last = s.round >= s.total_rounds
  const unanimous = total >= 2 && (lr.counts.a === 0 || lr.counts.b === 0)
  const av = Math.round((h * (order.length > 6 ? 8 : 10)) / 100)

  return (
    <>
      {/* Le dilemme, rappelé */}
      <div className="grid shrink-0 grid-cols-2" style={{ gap: vh(2) }}>
        {SIDES.map((side) => {
          const st = SIDE[side]
          const win = done && lr.majority === side
          return (
            <motion.div
              key={side}
              animate={{ scale: win ? 1.03 : done && lr.majority ? 0.97 : 1, opacity: done && lr.majority && !win ? 0.65 : 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 14 }}
              className={cn('sticker relative flex items-center justify-center text-center hyphens-auto', st.bg, st.text)}
              style={{ padding: `${vh(1)} ${vh(2)}`, minHeight: vh(14), gap: vh(1.5) }}
            >
              <span className="font-display font-extrabold opacity-80" style={{ fontSize: vh(5) }}>
                {st.letter}
              </span>
              <p lang="fr" className="font-display leading-tight font-extrabold break-words" style={{ fontSize: vh(fontFor(lr.dilemma[side], 3.8)) }}>
                {lr.dilemma[side]}
              </p>
              <AnimatePresence>
                {win && (
                  <motion.span
                    initial={{ scale: 0, rotate: -40 }}
                    animate={{ scale: 1, rotate: -12 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 10 }}
                    className="absolute -top-[3vh] -left-[1.5vh]"
                    style={{ fontSize: vh(7) }}
                  >
                    👑
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </div>

      {/* La barre qui se scinde */}
      <div className="relative shrink-0 overflow-hidden rounded-full border-[0.6vh] border-ink bg-sunk shadow-sticker" style={{ height: vh(9) }}>
        <div className="flex h-full">
          {SIDES.map((side) => (
            <motion.div
              key={side}
              className={cn('flex h-full items-center overflow-hidden', SIDE[side].bg, SIDE[side].text, side === 'a' ? 'justify-start pl-[2vh]' : 'justify-end pr-[2vh]')}
              initial={{ width: '50%' }}
              animate={{ width: split ? `${total ? pct[side] : 50}%` : '50%' }}
              transition={{ type: 'spring', stiffness: 120, damping: 16, delay: 0.15 }}
            >
              {split && (total ? pct[side] >= 10 : true) && (
                <motion.span
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ delay: 0.4, type: 'spring', stiffness: 500, damping: 12 }}
                  className="font-display font-extrabold whitespace-nowrap"
                  style={{ fontSize: vh(6) }}
                >
                  <AnimatedNumber value={total ? pct[side] : 0} duration={1.1} />%
                </motion.span>
              )}
            </motion.div>
          ))}
        </div>
        <motion.div
          className="absolute inset-0 flex items-center justify-center bg-ink"
          initial={{ clipPath: 'inset(0% 0% 0% 0%)' }}
          animate={{ clipPath: split ? 'inset(0% 50% 0% 50%)' : 'inset(0% 0% 0% 0%)' }}
          transition={{ duration: 0.55, ease: [0.7, 0, 0.3, 1] }}
        >
          {!split && (
            <motion.span animate={{ opacity: [0.4, 1, 0.4], scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 0.9 }} className="font-display font-extrabold text-paper" style={{ fontSize: vh(5) }}>
              Verdict…
            </motion.span>
          )}
        </motion.div>
      </div>

      {/* Les avatars s'envolent de chaque côté */}
      <LayoutGroup id={`tvtp-${lr.round}`}>
        <div className="grid min-h-0 flex-1 grid-cols-2" style={{ gap: vh(2) }}>
          {SIDES.map((side) => {
            const ids = order.filter((id) => placed.has(id) && lr.choices[id] === side)
            const win = done && lr.majority === side
            return (
              <div
                key={side}
                ref={lr.majority === side ? majRef : undefined}
                className={cn('relative flex flex-wrap content-start items-start justify-center overflow-hidden rounded-card border-[0.5vh] border-dashed', win ? 'border-solid border-ink bg-sun/25' : 'border-ink/30')}
                style={{ gap: vh(1.5), padding: vh(1.5), backgroundColor: win ? undefined : `${SIDE[side].hex}1A` }}
              >
                {ids.map((id) => (
                  <TvChip key={id} id={id} lr={lr} get={get} done={done} size={av} />
                ))}
                {ids.length === 0 && (
                  <span className="m-auto font-display font-extrabold opacity-40" style={{ fontSize: vh(5) }}>
                    {SIDE[side].letter}
                  </span>
                )}
              </div>
            )
          })}
        </div>
        {/* Réserve : avatars qui attendent leur envol */}
        {pool.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 z-10 flex flex-wrap items-center justify-center" style={{ bottom: vh(24), gap: vh(1) }}>
            {pool.map((id) => (
              <TvChip key={id} id={id} lr={lr} get={get} done={false} size={av} />
            ))}
          </div>
        )}
      </LayoutGroup>

      {/* Verdict */}
      <div className="flex shrink-0 items-center justify-center" style={{ minHeight: vh(9) }}>
        <AnimatePresence>
          {done && (
            <motion.div
              initial={{ scale: 0, rotate: -6 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 12 }}
              className={cn('sticker text-center font-display font-extrabold', lr.majority ? cn(SIDE[lr.majority].bg, SIDE[lr.majority].text) : 'bg-sun text-[#1f1b2e]')}
              style={{ padding: `${vh(0.8)} ${vh(3)}`, fontSize: vh(3.6) }}
            >
              {total === 0
                ? 'Personne n’a répondu ! 🦗'
                : lr.majority
                  ? `${unanimous ? 'Unanimité ! 🤝 ' : 'La majorité préfère : '}${lr.dilemma[lr.majority]}`
                  : 'Égalité parfaite ! ⚖️ Personne ne marque sur son pari.'}
              {lr.rebels.length > 0 && (
                <span className="ml-[2vh] inline-block rounded-full border-[0.4vh] border-ink bg-grape px-[1.5vh] text-white" style={{ fontSize: vh(3) }}>
                  🤘 Rebelle : {get(lr.rebels[0]).nickname}
                  {s.rebel_bonus ? ' +1' : ''}
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {done && silent.length > 0 && (
          <div className="ml-[2vh] flex items-center gap-[0.8vh]" style={{ fontSize: vh(2.4) }}>
            <span className="font-bold text-muted">Pas répondu :</span>
            {silent.map((id) => (
              <span key={id} className="opacity-60 grayscale">
                <Avatar slug={get(id).slug} tenue={get(id).equippedTenue} expression={mood(get(id), 'sleepy')} size={Math.round(h * 0.05)} />
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0">
        <TvScores id="tvtp-scores" players={s.players} scores={s.scores} get={get} gains={done ? lr.gains : undefined} />
      </div>
      {done && <TvNextIn deadline={s.deadline} label={last ? 'Résultats dans' : 'Dilemme suivant dans'} />}
    </>
  )
}

/** Avatar en vol : il « voyage » du centre vers son camp (layoutId). Pari juste : 🎯 ; seul de son avis : rebelle. */
function TvChip({ id, lr, get, done, size }: { id: string; lr: TpReveal; get: TvGet; done: boolean; size: number }) {
  const p = get(id)
  const ok = done && lr.bettors_ok.includes(id)
  const rebel = done && lr.rebels.includes(id)
  return (
    <motion.div layoutId={`tvtp-${lr.round}-${id}`} layout transition={{ type: 'spring', stiffness: 380, damping: 22 }} className="relative flex flex-col items-center">
      <motion.div
        className="rounded-full"
        animate={ok ? { boxShadow: ['0 0 0 0px rgba(255,183,3,0.95)', '0 0 0 14px rgba(255,183,3,0)'], scale: [1, 1.1, 1] } : { boxShadow: '0 0 0 0px rgba(255,183,3,0)', scale: 1 }}
        transition={ok ? { repeat: Infinity, duration: 1.3 } : { duration: 0.2 }}
      >
        <Avatar slug={p.slug} tenue={p.equippedTenue} expression={!done ? mood(p, 'think') : ok ? mood(p, 'proud') : mood(p, 'shocked')} size={size} badge={ok ? '🎯' : undefined} />
      </motion.div>
      {rebel && (
        <motion.span
          initial={{ scale: 0, rotate: 30 }}
          animate={{ scale: 1, rotate: -8 }}
          transition={{ type: 'spring', stiffness: 500, damping: 10, delay: 0.3 }}
          className="absolute -top-[1vh] -left-[2vh] rounded-full border-[0.3vh] border-ink bg-grape px-[0.8vh] font-display font-extrabold text-white"
          style={{ fontSize: vh(2) }}
        >
          🤘 rebelle
        </motion.span>
      )}
      <span className={cn('max-w-[14vh] truncate font-display font-extrabold', ok && 'text-tangerine')} style={{ fontSize: vh(2.4) }}>
        {p.nickname}
      </span>
    </motion.div>
  )
}
