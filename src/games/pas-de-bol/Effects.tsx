import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Eye } from 'lucide-react'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { Modal } from '@/components/ui/Modal'
import { burst } from '@/components/ui/confetti'
import { fx, playSound, vibrate, type SoundName } from '@/lib/feedback'
import { mood } from '@/features/soiree/players'
import { serverNow } from '@/features/soiree/useServerClock'
import type { PlayerInfo } from '../types'
import { PdbCardView } from './Card'
import { COLOR_META, PERSOS, sortHand } from './rules'
import type { PdbLogEntry, PdbPeek, PdbState } from './types'

type Get = (id: string) => PlayerInfo

/* -------------------------------------------------------------------------- */
/* File d'animations plein écran déclenchées par le journal du state           */
/* -------------------------------------------------------------------------- */

export type Splash =
  | { k: number; kind: 'pasdebol'; p: string; count: number }
  | { k: number; kind: 'out'; p: string; place: number }
  | { k: number; kind: 'perso'; e: Extract<PdbLogEntry, { t: 'play' }> }
  | { k: number; kind: 'denounce'; p: string; target: string }
  | { k: number; kind: 'announce'; p: string }
  | { k: number; kind: 'reshuffle' }

const DURATION: Record<Splash['kind'], number> = {
  pasdebol: 2300,
  out: 2600,
  perso: 2300,
  denounce: 1900,
  announce: 1500,
  reshuffle: 1200,
}

/** Transforme les nouvelles entrées du journal en sons + animations. */
export function useLogSplashes(s: PdbState, meId: string) {
  const seen = useRef(s.log_seq)
  const [queue, setQueue] = useState<Splash[]>([])

  useEffect(() => {
    const fresh = s.log.filter((e) => e.n > seen.current)
    if (!fresh.length) return
    seen.current = Math.max(...fresh.map((e) => e.n))
    const add: Splash[] = []
    for (const e of fresh) {
      switch (e.t) {
        case 'play':
          // mes propres cartes ont déjà fait « claque » au toucher ; les spéciales ont leur son à elles
          if (e.card.kind === 'perso') add.push({ k: e.n, kind: 'perso', e })
          else if (e.card.kind === 'num') {
            if (e.p !== meId) fx.slap()
          } else playSound(e.card.kind === 'wild4' ? 'plus4' : e.card.kind)
          break
        case 'draw':
          if (e.count >= 4) add.push({ k: e.n, kind: 'pasdebol', p: e.p, count: e.count })
          else if (e.p === meId) vibrate(12)
          else for (let i = 0; i < Math.min(e.count, 3); i++) window.setTimeout(() => fx.deal(), i * 120)
          break
        case 'out':
          add.push({ k: e.n, kind: 'out', p: e.p, place: e.place })
          break
        case 'denounce':
          add.push({ k: e.n, kind: 'denounce', p: e.p, target: e.target })
          break
        case 'announce':
          add.push({ k: e.n, kind: 'announce', p: e.p })
          break
        case 'reshuffle':
          add.push({ k: e.n, kind: 'reshuffle' })
          break
      }
    }
    // Les cartes perso de Dédé/Karo s'accompagnent de pioches : on garde l'ordre du journal.
    if (add.length) setQueue((q) => [...q, ...add].slice(-5))
  }, [s.log, meId])

  const current = queue[0] ?? null
  useEffect(() => {
    if (!current) return
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), DURATION[current.kind])
    return () => clearTimeout(t)
  }, [current])

  return { current, skip: () => setQueue((q) => q.slice(1)) }
}

export function SplashLayer({ splash, get, meId, onSkip }: { splash: Splash | null; get: Get; meId: string; onSkip: () => void }) {
  return createPortal(
    <AnimatePresence mode="wait">
      {splash && (
        <motion.div
          key={splash.k}
          className="fixed inset-0 z-40 flex items-center justify-center p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.15 } }}
          onClick={onSkip}
        >
          <div className="absolute inset-0 bg-[#07050f]/45" />
          <SplashBody splash={splash} get={get} meId={meId} />
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function SplashBody({ splash, get, meId }: { splash: Splash; get: Get; meId: string }) {
  const reduce = useReducedMotion()
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    if (splash.kind === 'pasdebol') {
      fx.fail()
      vibrate([80, 40, 80, 40, 160])
    } else if (splash.kind === 'out') {
      fx.fanfare()
      burst({ x: 0.5, y: 0.45 }, 140)
    } else if (splash.kind === 'perso') {
      playSound(`perso_${splash.e.card.perso}` as SoundName)
      vibrate([15, 30, 15])
    } else if (splash.kind === 'denounce') fx.fail()
    else if (splash.kind === 'announce') {
      playSound('bell')
      vibrate([15, 40, 25])
    } else {
      playSound('shuffle')
      vibrate(8)
    }
  }, [splash])

  const name = (id: string) => (id === meId ? 'Toi' : get(id).nickname)

  if (splash.kind === 'pasdebol') {
    const p = get(splash.p)
    return (
      <div className="relative flex flex-col items-center">
        {!reduce && (
          <motion.div
            className="absolute top-1/2 left-1/2 size-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: 'repeating-conic-gradient(#EF476F 0 12deg, #FFB703 12deg 24deg)' }}
            initial={{ scale: 0, rotate: 0 }}
            animate={{ scale: 1, rotate: 90 }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
          />
        )}
        <motion.div
          className="relative flex flex-col items-center"
          initial={{ scale: 0.2, rotate: -25 }}
          animate={reduce ? { scale: 1, rotate: 0 } : { scale: [0.2, 1.25, 1], rotate: [-25, 8, -4], x: [0, -8, 8, -6, 6, 0] }}
          transition={{ duration: 0.7 }}
        >
          <ChibiImage slug={p.slug} expression={mood(p, 'sad')} size={150} />
          <p
            className="-mt-4 -rotate-6 font-display text-6xl leading-none font-extrabold text-sun"
            style={{ WebkitTextStroke: '3px #1f1b2e', paintOrder: 'stroke fill', textShadow: '5px 5px 0 #1f1b2e' }}
          >
            PAS DE BOL&nbsp;!
          </p>
          <p className="sticker mt-3 rotate-2 bg-tomato px-4 py-1 font-display text-2xl font-extrabold text-white">
            {name(splash.p)} pioche{splash.p === meId ? 's' : ''} {splash.count} cartes
          </p>
        </motion.div>
      </div>
    )
  }

  if (splash.kind === 'out') {
    const p = get(splash.p)
    return (
      <motion.div className="relative flex flex-col items-center gap-2" initial={{ y: 200, scale: 0.4 }} animate={{ y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 13 }}>
        <motion.span className="text-7xl" animate={reduce ? undefined : { rotate: [-12, 12], y: [0, -10] }} transition={{ repeat: Infinity, repeatType: 'mirror', duration: 0.35 }}>
          {splash.place === 1 ? '🏆' : splash.place === 2 ? '🥈' : splash.place === 3 ? '🥉' : '🎉'}
        </motion.span>
        <ChibiImage slug={p.slug} expression={mood(p, 'proud')} size={150} />
        <p className="sticker bg-mint px-4 py-1 text-center font-display text-3xl font-extrabold text-[#1f1b2e]">
          {name(splash.p)} {splash.p === meId ? 'sors' : 'sort'} n°{splash.place} !
        </p>
        <p className="font-bold text-white">Plus aucune carte en main 🙌</p>
      </motion.div>
    )
  }

  if (splash.kind === 'perso') {
    const e = splash.e
    const meta = PERSOS[e.card.perso!]
    const actor = name(e.p)
    const target = e.target ? name(e.target) : ''
    const text = (() => {
      switch (meta.slug) {
        case 'kevin': return `${actor} rejoue tout de suite !`
        case 'cycy': return `${actor} échange sa main avec ${target} !`
        case 'dede': return `Tous les autres piochent 1 carte !`
        case 'manon': return e.stolen ? `${actor} lit la main de ${target} et lui prend une carte !` : `${actor} lit en secret la main de ${target}…`
        case 'mika': return `Le sens s’inverse ! Couleur : ${COLOR_META[e.color].label}`
        case 'cecile': return `${actor} défausse ${e.discarded?.length ?? 0} carte${(e.discarded?.length ?? 0) > 1 ? 's' : ''} ${e.chosen ? COLOR_META[e.chosen].label : ''} en plus !`
        case 'carole': return `${target} pioche 3 cartes !`
        case 'marius': return e.blocked ? `Cumul de +${e.blocked} annulé !` : `${actor} se cache sous sa capuche : le joueur suivant passe son tour !`
        case 'nini': return `Tout le monde passe sa main au voisin !`
      }
    })()
    return (
      <div className="relative flex flex-col items-center gap-3">
        <motion.div
          initial={{ scale: 0.3, rotateY: 180, rotate: -20 }}
          animate={{ scale: 1, rotateY: 0, rotate: -4 }}
          transition={{ type: 'spring', stiffness: 200, damping: 14 }}
        >
          <PdbCardView card={e.card} w={150} />
        </motion.div>
        <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.25 }} className="sticker max-w-xs bg-surface px-4 py-2 text-center">
          <p className="font-display text-2xl leading-tight font-extrabold">
            {meta.emoji} {meta.title}
          </p>
          <p className="font-bold">{text}</p>
        </motion.div>
      </div>
    )
  }

  if (splash.kind === 'denounce') {
    const t = get(splash.target)
    return (
      <motion.div className="relative flex flex-col items-center gap-2" initial={{ scale: 0, rotate: 30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 12 }}>
        <span className="text-7xl">🚨</span>
        <ChibiImage slug={t.slug} expression={mood(t, 'shocked')} size={130} />
        <p className="sticker bg-tomato px-4 py-1 text-center font-display text-3xl font-extrabold text-white">Dénoncé·e !</p>
        <p className="text-center font-bold text-white">
          {name(splash.p)} a grillé {name(splash.target)} : +2 cartes !
        </p>
      </motion.div>
    )
  }

  if (splash.kind === 'announce') {
    const p = get(splash.p)
    return (
      <motion.div className="relative flex flex-col items-center gap-2" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 12 }}>
        <ChibiImage slug={p.slug} expression={mood(p, 'sly')} size={120} />
        <p className="sticker -rotate-3 bg-sun px-4 py-1 font-display text-4xl font-extrabold text-[#1f1b2e]">Dernière carte !</p>
        <p className="font-bold text-white">{name(splash.p)} l’a annoncé à temps.</p>
      </motion.div>
    )
  }

  return (
    <motion.div className="sticker relative bg-surface px-5 py-3 text-center" initial={{ scale: 0, rotate: -10 }} animate={{ scale: 1, rotate: reduce ? 0 : 360 }} transition={{ duration: 0.6 }}>
      <p className="font-display text-2xl font-extrabold">🔀 On remélange la défausse !</p>
    </motion.div>
  )
}

/* -------------------------------------------------------------------------- */
/* Cartes qui volent de la pioche vers celui qui pioche                         */
/* -------------------------------------------------------------------------- */

type Pt = { x: number; y: number }
type Flight = { id: string; from: Pt; to: Pt; delay: number }

const centerOf = (el: Element): Pt => {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/** Repères dans le DOM : la pioche (`data-pdb-pile`) et les places (`data-seat`, « me » = ma main). */
export function DrawFlights({ s, meId }: { s: PdbState; meId: string }) {
  const seen = useRef(s.log_seq)
  const reduce = useReducedMotion()
  const [flights, setFlights] = useState<Flight[]>([])

  useEffect(() => {
    const fresh = s.log.filter((e) => e.n > seen.current)
    if (!fresh.length) return
    seen.current = Math.max(...fresh.map((e) => e.n))
    if (reduce) return
    const pile = document.querySelector('[data-pdb-pile]')
    if (!pile) return
    const from = centerOf(pile)
    const targets: Array<[string, number, string?]> = []
    for (const e of fresh) {
      if (e.t === 'draw') targets.push([e.p, Math.min(e.count, 4)])
      else if (e.t === 'denounce') targets.push([e.target, Math.min(e.count, 4)])
      else if (e.t === 'play' && e.card.kind === 'perso') {
        if (e.card.perso === 'carole' && e.target) targets.push([e.target, 3])
        if (e.card.perso === 'manon' && e.target && e.stolen) targets.push([e.p, 1, e.target])
        if (e.card.perso === 'dede') for (const id of s.active) if (id !== e.p) targets.push([id, 1])
      }
    }
    const batch = `${fresh[0].n}-${Math.random().toString(36).slice(2, 6)}`
    const add: Flight[] = []
    let slot = 0
    const seatOf = (id: string) => document.querySelector(`[data-seat="${id === meId ? 'me' : id}"]`)
    for (const [id, count, src] of targets) {
      const el = seatOf(id)
      if (!el) continue
      const origin = src ? seatOf(src) : null
      const start = origin ? centerOf(origin) : from
      const to = centerOf(el)
      for (let i = 0; i < count; i++) add.push({ id: `${batch}-${slot++}`, from: start, to, delay: i * 0.1 })
    }
    if (!add.length) return
    setFlights((f) => [...f, ...add])
    window.setTimeout(() => setFlights((f) => f.filter((x) => !x.id.startsWith(batch))), 1500)
  }, [s.log, s.active, meId, reduce])

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-30">
      {flights.map((f) => (
        <motion.div
          key={f.id}
          className="absolute"
          style={{ left: f.from.x - 17, top: f.from.y - 25 }}
          initial={{ x: 0, y: 0, scale: 1, rotate: -10, opacity: 0 }}
          animate={{ x: f.to.x - f.from.x, y: f.to.y - f.from.y, scale: 0.6, rotate: 14, opacity: [0, 1, 1, 0] }}
          transition={{ delay: f.delay, duration: 0.6, ease: 'easeInOut', opacity: { delay: f.delay, duration: 0.6, times: [0, 0.1, 0.8, 1] } }}
        >
          <PdbCardView back w={34} />
        </motion.div>
      ))}
    </div>,
    document.body,
  )
}

/* -------------------------------------------------------------------------- */
/* Petit carnet de Manon : la main d'un joueur, à moi seul, quelques secondes  */
/* -------------------------------------------------------------------------- */

const PEEK_MS = 6000

export function PeekModal({ peek, get }: { peek: PdbPeek | undefined; get: Get }) {
  const [shown, setShown] = useState<PdbPeek | null>(null)
  const handled = useRef<number | null>(null)

  useEffect(() => {
    if (!peek || handled.current === peek.n) return
    handled.current = peek.n
    // Un vieux « peek » relu après un rechargement n'est pas réaffiché.
    if (new Date(peek.until).getTime() < serverNow() - 3000) return
    setShown(peek)
    fx.whoosh()
  }, [peek])

  useEffect(() => {
    if (!shown) return
    const t = window.setTimeout(() => setShown(null), PEEK_MS)
    return () => clearTimeout(t)
  }, [shown])

  const target = shown ? get(shown.target) : null
  return (
    <Modal open={!!shown} onClose={() => setShown(null)} title="Petit carnet ✏️">
      {shown && target && (
        <div className="flex flex-col gap-3">
          <p className="flex items-center gap-2 font-bold">
            <Eye className="size-5 shrink-0" /> Main de {target.nickname} ({shown.hand.length} carte{shown.hand.length > 1 ? 's' : ''}) — chut !{shown.stolen ? ' Tu lui prends la carte brillante.' : ''}
          </p>
          <div className="flex flex-wrap justify-center gap-1.5">
            {sortHand(shown.hand).map((c, i) => (
              <motion.div key={c.id} className="relative" initial={{ y: 30, opacity: 0, rotate: -8 }} animate={{ y: 0, opacity: 1, rotate: 0 }} transition={{ delay: i * 0.04 }}>
                <PdbCardView card={c} w={52} glow={c.id === shown.stolen} dim={!!shown.stolen && c.id !== shown.stolen} />
                {c.id === shown.stolen && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border-2 border-ink bg-tomato px-1.5 text-[10px] font-extrabold whitespace-nowrap text-white">Volée !</span>}
              </motion.div>
            ))}
          </div>
          <div className="h-2 overflow-hidden rounded-full border-2 border-ink bg-sunk">
            <motion.div className="h-full bg-grape" initial={{ width: '100%' }} animate={{ width: '0%' }} transition={{ duration: PEEK_MS / 1000, ease: 'linear' }} />
          </div>
        </div>
      )}
    </Modal>
  )
}
