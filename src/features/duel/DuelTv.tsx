import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Lock } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { pickExpression } from '@/features/soiree/players'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { PlayerInfo } from '@/games/types'
import type { DuelPlayProps } from './DuelPlay'
import { DuelResultBanner } from './DuelResult'
import { TimerRing } from './DuelStage'
import { DuelTransition } from './DuelTransition'
import { Bracket, ScoreStrip } from './SessionBoard'
import { FIGHTER_MOODS, fighterMood, pickSideColors, roundNameSingular, winsNeeded } from './logic'
import { useDuel, useDuelTicker } from './useDuel'
import type { DuelInfo, DuelSession, DuelState } from './types'

type Get = (id: string) => PlayerInfo
const noop = () => {}

/** Taille de la fenêtre (px), mise à jour au redimensionnement / à la rotation. */
export function useViewport() {
  const read = () => ({ w: window.innerWidth, h: window.innerHeight })
  const [vp, setVp] = useState(read)
  useEffect(() => {
    const on = () => setVp(read())
    window.addEventListener('resize', on)
    window.addEventListener('orientationchange', on)
    return () => {
      window.removeEventListener('resize', on)
      window.removeEventListener('orientationchange', on)
    }
  }, [])
  return vp
}

/* -------------------------------------------------------------------------- */
/* Plateau mis à l'échelle de la place disponible                              */
/* -------------------------------------------------------------------------- */

/**
 * Agrandit (ou réduit) son contenu pour remplir la boîte sans déborder : le
 * plateau est rendu à sa largeur « téléphone » puis mis à l'échelle (transform),
 * centré. La boîte ne dépend pas du contenu (pas de boucle de mesure).
 */
function FitBox({ children, maxScale = 2.6, natural = false }: { children: ReactNode; maxScale?: number; /** Largeur propre du contenu (max-content) au lieu de la largeur « téléphone ». */ natural?: boolean }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ base: 400, scale: 1, top: 0 })
  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    const measure = () => {
      const aw = o.clientWidth
      const ah = o.clientHeight
      if (!aw || !ah) return
      const base = Math.min(440, aw)
      const nh = i.offsetHeight || 1
      const nw = i.offsetWidth || base
      const scale = Math.max(0.45, Math.min(maxScale, aw / nw, ah / nh))
      const top = Math.max(0, (ah - nh * scale) / 2)
      setFit((f) => (Math.abs(f.scale - scale) < 0.005 && f.base === base && Math.abs(f.top - top) < 1 ? f : { base, scale, top }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(o)
    ro.observe(i)
    return () => ro.disconnect()
  }, [maxScale])
  return (
    <div ref={outer} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        ref={inner}
        className="absolute left-1/2"
        style={{ width: natural ? 'max-content' : fit.base, top: fit.top, transform: `translateX(-50%) scale(${fit.scale})`, transformOrigin: 'top center' }}
      >
        {children}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Un duelliste en grand                                                       */
/* -------------------------------------------------------------------------- */

interface TvFighterProps {
  s: DuelState
  duel: DuelInfo
  session: DuelSession
  id: string
  player: PlayerInfo
  side: 'a' | 'b'
  color: string
  size: number
  frac: number
  secLeft: number
  backers: number
}

function TvFighter({ s, duel, session, id, player, side, color, size, frac, secLeft, backers }: TvFighterProps) {
  const reduce = useReducedMotion()
  const active = s.phase === 'playing' && duel.turn === id
  const m = fighterMood(s, id, s.phase === 'playing' ? frac : 1)
  const info = FIGHTER_MOODS[m]
  const expr = pickExpression(player, ...info.expr)
  const need = winsNeeded(session.best_of)
  const wins = duel.wins[id] ?? 0
  const final = s.phase === 'result' && !!duel.result
  const tournament = session.mode === 'tournament'
  const label =
    final && tournament && m === 'lose'
      ? 'éliminé·e'
      : final && tournament && m === 'win'
        ? session.over
          ? 'grosse tête !'
          : 'qualifié·e !'
        : info.label
  const ring = size + Math.round(size * 0.22)
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div className="relative flex items-center justify-center" style={{ width: ring, height: ring }}>
        {active && <TimerRing frac={frac} size={ring} stroke={Math.max(6, size * 0.06)} />}
        <motion.div
          className="relative rounded-full border-4 border-ink shadow-sticker"
          style={{ width: size, height: size, background: color }}
          animate={
            reduce
              ? undefined
              : m === 'think' || m === 'panic'
                ? { y: [0, -6, 0], rotate: [0, side === 'a' ? -4 : 4, 0] }
                : m === 'win'
                  ? { y: [0, -14, 0], scale: [1, 1.08, 1] }
                  : m === 'angry'
                    ? { x: [0, -4, 4, -4, 0] }
                    : m === 'sleepy'
                      ? { rotate: side === 'a' ? [0, -8, 0] : [0, 8, 0] }
                      : { y: 0, x: 0, rotate: 0, scale: 1 }
          }
          transition={
            m === 'think' || m === 'panic' || m === 'win' || m === 'sleepy' || m === 'angry'
              ? { repeat: Infinity, duration: m === 'panic' ? 0.45 : m === 'sleepy' ? 2.4 : m === 'angry' ? 0.5 : 0.9 }
              : undefined
          }
        >
          <div className="size-full overflow-hidden rounded-full">
            <motion.div
              key={expr}
              initial={reduce ? false : { scale: 1.25 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 14 }}
            >
              <ChibiImage
                slug={player.slug}
                expression={expr}
                tenue={player.equippedTenue}
                size={size * 0.94}
                bare
                className={cn('mt-[6%]', side === 'b' && '-scale-x-100', m === 'lose' && final && 'grayscale-[60%]')}
              />
            </motion.div>
          </div>
          <AnimatePresence mode="popLayout">
            {info.bubble && (
              <motion.span
                key={m}
                initial={reduce ? { opacity: 0 } : { scale: 0, rotate: -30, opacity: 0 }}
                animate={{ scale: 1, rotate: side === 'a' ? 8 : -8, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 14 }}
                className={cn(
                  'absolute -top-1 flex items-center justify-center rounded-full border-[3px] border-ink bg-surface shadow-sticker-sm',
                  side === 'a' ? '-right-2' : '-left-2',
                )}
                style={{ width: size * 0.36, height: size * 0.36, fontSize: size * 0.2 }}
                aria-hidden
              >
                {info.bubble}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
        {active && (
          <span
            className={cn(
              'absolute -bottom-1 rounded-full border-[3px] border-ink bg-surface px-3 font-display leading-tight font-extrabold tabular-nums shadow-sticker-sm',
              secLeft <= 5 && 'bg-tomato text-white',
            )}
            style={{ fontSize: Math.max(18, size * 0.16) }}
          >
            {secLeft}s
          </span>
        )}
      </div>
      <span
        className="max-w-full truncate rounded-lg border-[3px] border-ink px-2 font-display leading-tight font-extrabold text-[#1f1b2e] shadow-sticker-sm"
        style={{ background: color, fontSize: Math.max(16, Math.min(40, size * 0.17)) }}
      >
        {player.nickname}
      </span>
      <AnimatePresence mode="wait">
        {label && (
          <motion.span
            key={label}
            initial={{ y: -6, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ opacity: 0 }}
            className="font-display font-extrabold"
            style={{ fontSize: Math.max(13, Math.min(28, size * 0.11)) }}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
      <div className="flex flex-wrap items-center justify-center gap-x-2 font-bold text-muted tabular-nums" style={{ fontSize: Math.max(12, Math.min(22, size * 0.09)) }}>
        <span>
          {session.scores[id] ?? 0} pt{(session.scores[id] ?? 0) > 1 ? 's' : ''}
        </span>
        {backers > 0 && <span>· 🎟️ {backers}</span>}
      </div>
      {need > 1 && (
        <div className="flex gap-1.5" aria-label={`${wins} manche(s) gagnée(s) sur ${need}`}>
          {Array.from({ length: need }, (_, i) => (
            <motion.span
              key={i}
              animate={i < wins && !reduce ? { scale: [1.6, 1] } : { scale: 1 }}
              className="rounded-full border-[3px] border-ink"
              style={{ width: size * 0.12, height: size * 0.12, background: i < wins ? color : 'transparent' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}


/* -------------------------------------------------------------------------- */
/* Paris du public (lecture seule)                                             */
/* -------------------------------------------------------------------------- */

function TvBets({ duel, get, colors, open, big }: { duel: DuelInfo; get: Get; colors: { a: string; b: string }; open: boolean; big?: boolean }) {
  const reduce = useReducedMotion()
  const backers = (id: string) => Object.entries(duel.bets).filter(([, t]) => t === id).map(([b]) => b)
  const la = backers(duel.a)
  const lb = backers(duel.b)
  const total = la.length + lb.length
  const pa = total ? la.length / total : 0.5
  const head = big ? 40 : 28
  const heads = (list: string[]) => (
    <div className="flex min-w-0 flex-wrap justify-center -space-x-2">
      {list.slice(0, 8).map((b) => (
        <motion.span key={b} initial={reduce ? false : { scale: 0, y: -12 }} animate={{ scale: 1, y: 0 }}>
          <Avatar slug={get(b).slug} expression={pickExpression(get(b), 'pouces', 'joie')} size={head} />
        </motion.span>
      ))}
      {list.length > 8 && <span className="pl-3 font-extrabold">+{list.length - 8}</span>}
    </div>
  )
  return (
    <div className={cn('sticker flex flex-col gap-1.5 bg-surface px-3 py-2', big && 'gap-3 px-5 py-4')}>
      <div className={cn('flex items-center justify-center gap-2 font-display font-extrabold', big ? 'text-2xl' : 'text-base')}>
        🎟️ {total === 0 ? (open ? 'Le public, faites vos paris !' : 'Aucun pari') : open ? 'Les paris du public' : 'Paris fermés'}
        {!open && <Lock className="size-4 text-muted" />}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 justify-start">{heads(la)}</div>
        <span className={cn('font-display font-extrabold tabular-nums', big ? 'text-3xl' : 'text-lg')}>{la.length}</span>
        {/* Tir à la corde des paris */}
        <div className={cn('relative w-[38%] max-w-72 shrink-0 overflow-hidden rounded-full border-[3px] border-ink', big ? 'h-6' : 'h-4')} style={{ background: colors.b }}>
          <motion.div
            className="absolute inset-y-0 left-0"
            style={{ background: colors.a }}
            initial={false}
            animate={{ width: `${pa * 100}%` }}
            transition={{ type: 'spring', stiffness: 160, damping: 18 }}
          />
          <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-ink/40" />
        </div>
        <span className={cn('font-display font-extrabold tabular-nums', big ? 'text-3xl' : 'text-lg')}>{lb.length}</span>
        <div className="flex min-w-0 flex-1 justify-end">{heads(lb)}</div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Vue télé                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Mode télé d'un jeu en duel (rendu par DuelPlay sous DuelTvContext) : plateau
 * en grand, duellistes en grosses têtes dont l'expression suit la partie,
 * score, minuteur, paris ; affiche de combat en transition (avec le tableau du
 * tournoi). Lecture seule : `me` est un id fictif, pas de secret, plateau inerte.
 */
export function DuelTv<B, M>({ state, meId, isHost, players, act, Board, sideColors }: DuelPlayProps<B, M>) {
  const reduce = useReducedMotion()
  const v = useDuel<B, M>(state, meId, players)
  const { s, duel, session, phase, get } = v
  const { w, h } = useViewport()
  const landscape = w > h * 1.05
  useDuelTicker(s, act, meId, isHost)

  const colors = useMemo(() => {
    if (!duel) return { a: '#EF476F', b: '#FFB703' }
    const pa = get(duel.a)
    const pb = get(duel.b)
    return sideColors ? sideColors(pa, pb) : pickSideColors(pa.color, pb.color)
  }, [duel, get, sideColors])

  const total = (session?.turn_seconds || 30) * 1000
  const frac = v.left / total
  const secLeft = Math.ceil(v.left / 1000)
  // Tic-tac pour toute la salle dans les 5 dernières secondes d'un coup.
  useEffect(() => {
    if (phase === 'playing' && secLeft > 0 && secLeft <= 5) fx.tick()
  }, [phase, secLeft])

  if (!duel || !session) return null

  const backers = (id: string) => Object.values(duel.bets).filter((t) => t === id).length
  const tournament = session.mode === 'tournament' && !!session.bracket

  /* ---- annonce du duel : affiche de combat (+ tableau du tournoi) ---- */
  if (phase === 'transition') {
    const head = Math.round(landscape ? Math.min(w * 0.17, h * 0.24, 300) : Math.min(w * 0.34, h * 0.2, 280))
    return (
      <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
        <div className={cn('mx-auto flex w-full gap-3', landscape ? 'max-w-[2400px] flex-row items-stretch' : 'max-w-3xl flex-col')}>
          <div className={cn('min-w-0', landscape ? 'flex-[3]' : '')}>
            <DuelTransition duel={duel} session={session} meId={meId} get={get} colors={colors} left={v.left} isHost={false} pending={false} onStart={noop} tv headSize={head}>
              <TvBets duel={duel} get={get} colors={colors} open={v.betsOpen} big />
            </DuelTransition>
          </div>
          {tournament &&
            (landscape ? (
              // Paysage : le tableau entier, mis à l'échelle de la colonne (pas de défilement sur une télé).
              <div className="sticker flex min-w-0 flex-[2] flex-col self-stretch bg-surface p-3">
                <p className="font-display text-xl font-extrabold">🏆 Le tableau</p>
                <FitBox natural maxScale={1.8}>
                  <Bracket s={s} get={get} meId={meId} fit />
                </FitBox>
              </div>
            ) : (
              <div className="sticker min-w-0 bg-surface p-3">
                <p className="font-display text-xl font-extrabold">🏆 Le tableau</p>
                <Bracket s={s} get={get} meId={meId} big={w >= 700} />
              </div>
            ))}
        </div>
      </div>
    )
  }

  if (phase !== 'setup' && phase !== 'playing' && phase !== 'result') return null

  /* ---- le duel en cours ---- */
  // Place des têtes : en paysage, la hauteur restante (en-tête, paris, nom et score sous la tête).
  const roomy = h >= 600
  const size = Math.round(landscape ? Math.max(72, Math.min(w * 0.17, (h - 52 - (roomy ? 130 : 80) - 90) / 1.25, 320)) : Math.min(w * 0.27, h * 0.15, 220))
  const fighter = (id: string, side: 'a' | 'b') => (
    <TvFighter s={s} duel={duel} session={session} id={id} player={get(id)} side={side} color={colors[side]} size={size} frac={frac} secLeft={secLeft} backers={backers(id)} />
  )
  const wa = duel.wins[duel.a] ?? 0
  const wb = duel.wins[duel.b] ?? 0
  const turnP = duel.turn ? get(duel.turn) : null
  const center = (
    <div className="flex flex-col items-center gap-1 text-center">
      {tournament && duel.round != null && (
        <span className="rounded-full border-2 border-ink bg-sun px-3 font-display text-sm font-extrabold text-[#1f1b2e] uppercase">
          {roundNameSingular(duel.round, session.bracket!.rounds.length)}
          {duel.replay ? ' · revanche' : ''}
        </span>
      )}
      {session.best_of > 1 ? (
        <span className="font-display leading-none font-extrabold tabular-nums" style={{ fontSize: Math.max(28, size * 0.3) }}>
          <span style={{ color: colors.a, WebkitTextStroke: '2px var(--ink)' }}>{wa}</span>
          <span className="px-1 text-muted">–</span>
          <span style={{ color: colors.b, WebkitTextStroke: '2px var(--ink)' }}>{wb}</span>
        </span>
      ) : (
        <motion.span
          className="font-display leading-none font-extrabold text-tomato"
          style={{ textShadow: '3px 3px 0 var(--ink)', fontSize: Math.max(32, size * 0.3) }}
          animate={reduce ? undefined : { rotate: [-8, 8, -8], scale: [1, 1.12, 1] }}
          transition={{ repeat: Infinity, duration: 1.8 }}
        >
          VS
        </motion.span>
      )}
      <AnimatePresence mode="wait">
        <motion.span
          key={`${phase}-${duel.turn}-${duel.game_no}`}
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ opacity: 0 }}
          className="max-w-full font-display font-extrabold"
          style={{ fontSize: Math.max(15, Math.min(30, size * 0.12)) }}
        >
          {phase === 'setup'
            ? `🤫 Préparation secrète · ${Math.max(0, secLeft)}s`
            : phase === 'playing'
              ? turnP
                ? `${turnP.nickname} joue…`
                : ''
              : duel.result
                ? 'Fin du duel !'
                : 'Fin de la manche !'}
        </motion.span>
      </AnimatePresence>
      {session.best_of > 1 && duel.game_no > 0 && <span className="text-sm font-bold text-muted">Manche {duel.game_no}</span>}
    </div>
  )

  const board =
    s.board != null ? (
      <FitBox>
        {/* inert : jamais de coup depuis la télé */}
        <div inert className="pointer-events-none select-none">
          <Board
            board={s.board}
            me={meId}
            isMyTurn={false}
            onMove={noop}
            onReady={noop}
            pending={false}
            duel={duel}
            phase={phase}
            spectator
            get={get}
            colors={colors}
            secret={null}
          />
        </div>
      </FitBox>
    ) : (
      <div className="flex-1" />
    )

  // Fin de manche / de duel : bandeau par-dessus le bas du plateau (la place reste au plateau).
  const stage = (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {board}
      <AnimatePresence>
        {phase === 'result' && (
          <div key={`${duel.no}-${duel.game_no}`} className="absolute inset-x-0 bottom-0 z-10 flex justify-center px-1">
            <div className="w-full max-w-2xl">
              <DuelResultBanner
                duel={duel}
                session={session}
                meId={meId}
                get={get}
                colors={colors}
                left={v.left}
                isHost={false}
                pending={false}
                onNext={noop}
              />
            </div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )

  const footer = (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-1.5">
      <TvBets duel={duel} get={get} colors={colors} open={v.betsOpen} />
      {roomy && <ScoreStrip s={s} get={get} meId={meId} duel={duel} />}
    </div>
  )

  return (
    <div className="relative flex h-full flex-col gap-2 overflow-hidden p-2">
      {/* fond aux couleurs des duellistes */}
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{ background: `linear-gradient(100deg, ${colors.a} 0%, transparent 38%, transparent 62%, ${colors.b} 100%)` }}
        aria-hidden
      />
      {landscape ? (
        <div className="relative flex min-h-0 flex-1 items-stretch gap-2">
          <div className="flex w-[22%] shrink-0 flex-col items-center justify-center">{fighter(duel.a, 'a')}</div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {center}
            {stage}
          </div>
          <div className="flex w-[22%] shrink-0 flex-col items-center justify-center">{fighter(duel.b, 'b')}</div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-1">
            <div className="flex min-w-0 flex-1 justify-center">{fighter(duel.a, 'a')}</div>
            <div className="flex w-[34%] shrink-0 justify-center self-center">{center}</div>
            <div className="flex min-w-0 flex-1 justify-center">{fighter(duel.b, 'b')}</div>
          </div>
          {stage}
        </div>
      )}
      <div className="relative shrink-0">{footer}</div>
    </div>
  )
}
