import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Hourglass } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { playSound } from '@/lib/feedback'
import { mood, playerOrPlaceholder } from '@/features/soiree/players'
import { serverNow, useCountdown } from '@/features/soiree/useServerClock'
import { useViewport } from '@/features/tv/tv'
import type { GamePlayProps } from '../types'
import { hasBell, maxStrokes, pickedUp } from './holes'
import { MARK_DOT, holeAt, markOf, ranking, spriteOf, vsPar } from './logic'
import { useGolfNet } from './net'
import { HoleEnd } from './HoleEnd'
import { fmtClock, useDeadlineTick } from './useTick'
import type { GolfMsg, MiniGolfState } from './types'
import type { GolfScene } from './scene/GolfScene'

/**
 * Vue télé du Mini-golf (rendue par Play sous TvContext) : lecture seule. Le trou en cours vu de haut
 * (à l'horizontale sur un écran paysage) avec les balles de tout le monde (broadcast `golf:<matchId>`)
 * + le classement en direct. Seuls les `tick` partent.
 */
export function MiniGolfTv({ matchId, state, act, players }: GamePlayProps) {
  const s = state as unknown as MiniGolfState
  const { w, h } = useViewport()
  const landscape = w > h * 1.05
  const left = useDeadlineTick(s, act, true)
  const startLeft = useCountdown(s.phase === 'playing' ? s.hole_started_at : null)
  const announcing = s.phase === 'playing' && startLeft > 0
  const def = holeAt(s, s.hole)
  const par = s.pars[s.hole] ?? def.par
  const get = useCallback((id: string) => playerOrPlaceholder(players, id), [players])

  // Coups en cours de chacun (broadcast), rafraîchis 3 fois par seconde.
  const live = useRef<Record<string, { h: number; n: number; s: number }>>({})
  const [, force] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => force((x) => x + 1), 350)
    return () => clearInterval(id)
  }, [])

  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<GolfScene | null>(null)
  const [ready, setReady] = useState(false)
  const holeRef = useRef(s.hole)
  holeRef.current = s.hole
  useGolfNet(matchId, (m: GolfMsg) => {
    live.current[m.id] = { h: m.h, n: m.n, s: m.s }
    if (m.h !== holeRef.current) return
    const p = playerOrPlaceholder(players, m.id)
    sceneRef.current?.setGhost(m.id, { color: p.color, sprite: spriteOf(p) }, [m.x, m.y, m.z], m.s)
  })

  useEffect(() => {
    let alive = true
    let scene: GolfScene | null = null
    import('./scene/GolfScene')
      .then(({ GolfScene: Scene }) => {
        if (!alive || !host.current) return
        try {
          scene = new Scene(host.current, { dark: true, landscape, now: serverNow, callbacks: {}, ghostScale: 1.5, frame: landscape ? { top: 0.12, bottom: 0.05, side: 0.03 } : undefined })
        } catch (e) {
          console.warn('[mini-golf] télé : WebGL indisponible', e)
          return
        }
        sceneRef.current = scene
        setReady(true)
      })
      .catch(() => undefined)
    return () => {
      alive = false
      sceneRef.current = null
      scene?.dispose()
      setReady(false)
    }
  }, [landscape])

  const loaded = useRef('')
  useEffect(() => {
    const sc = sceneRef.current
    if (!ready || !sc) return
    const key = `${landscape}:${s.hole}`
    if (loaded.current === key) return
    loaded.current = key
    sc.loadHole(holeAt(s, s.hole), null, serverNow() < new Date(s.hole_started_at).getTime())
    for (const id of s.players) sc.removeGhost(id)
  }, [ready, s, landscape])

  // Cloche du clocher et « pop » quand quelqu'un rentre sa balle.
  const lastKey = useRef<string | null>(null)
  useEffect(() => {
    const lh = s.last_hole
    const key = lh ? `${lh.id}:${lh.at}` : ''
    const first = lastKey.current === null
    lastKey.current = key
    if (first || !lh) return
    if (lh.holed) {
      playSound('pop')
      if (hasBell(holeAt(s, lh.hole))) sceneRef.current?.ringBell()
    }
  }, [s.last_hole, s])

  const rows = ranking(s)
  const clock = s.phase === 'playing' && s.deadline ? (announcing ? s.timer * 1000 : left) : null

  return (
    <div className={cn('flex h-[100dvh] w-full gap-3 overflow-hidden bg-paper p-3', landscape ? 'flex-row' : 'flex-col')}>
      <div className="relative min-h-0 min-w-0 flex-1">
        <div ref={host} className="sticker absolute inset-0 overflow-hidden bg-sunk" />
        <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between gap-3">
          <div className="sticker bg-surface/95 px-4 py-2 leading-tight">
            <div className="font-display text-3xl font-extrabold">
              Trou {s.hole + 1}/{s.holes.length} <span className="text-muted">· par {par}</span>
            </div>
            <div className="text-xl font-bold text-muted">
              {def.name} — {def.blurb}
            </div>
          </div>
          {clock !== null && (
            <span className={cn('sticker flex items-center gap-2 px-3 py-1 font-display text-4xl font-extrabold tabular-nums', clock <= 10000 && !announcing ? 'bg-tomato text-white' : 'bg-surface/95')}>
              <Hourglass className="size-7" />
              {fmtClock(clock)}
            </span>
          )}
        </div>
        <AnimatePresence>
          {announcing && (
            <motion.div key={`a${s.hole}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
              <motion.div initial={{ scale: 2.5, rotate: -12 }} animate={{ scale: 1, rotate: -3 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }} className="sticker bg-sun px-10 py-6 text-center text-[#1f1b2e]" style={{ boxShadow: '10px 10px 0 0 var(--ink)' }}>
                <div className="font-display text-3xl font-extrabold">Trou {s.hole + 1}</div>
                <div className="font-display text-6xl leading-none font-extrabold">{def.name}</div>
                <div className="mt-2 font-display text-3xl font-extrabold">⛳ par {par}</div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>{s.phase === 'hole_end' && <HoleEnd key={`e${s.hole}`} s={s} get={get} meId="" left={left} big />}</AnimatePresence>
      </div>

      <div className={cn('flex shrink-0 flex-col gap-2 overflow-hidden', landscape ? 'w-[min(30vw,380px)]' : 'max-h-[38vh]')}>
        <div className="font-display text-2xl font-extrabold">🏆 Classement</div>
        {rows.map((r) => {
          const p = get(r.id)
          const done = s.done.includes(r.id)
          const sc = s.cards?.[r.id]?.[s.hole]
          const lv = live.current[r.id]
          const n = lv && lv.h === s.hole ? lv.n : 0
          return (
            <motion.div layout key={r.id} className={cn('sticker-sm flex items-center gap-2 px-2 py-1', done ? 'bg-mint/30' : 'bg-surface')}>
              <span className="w-7 text-center font-display text-2xl font-extrabold">{r.rank}</span>
              <Avatar slug={p.slug} tenue={p.equippedTenue} expression={mood(p, done && sc !== undefined && sc <= par ? 'proud' : 'think')} size={48} />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate text-lg font-extrabold">{p.nickname}</span>
                <span className="text-sm font-bold text-muted">
                  {s.phase === 'playing' && done && sc !== undefined
                    ? `${MARK_DOT[markOf(sc, par)]} ${sc >= pickedUp(par) ? `ramassée (${sc})` : `rentré en ${sc}`}`
                    : s.phase === 'playing'
                      ? `⛳ coup ${Math.min(n + 1, maxStrokes(par))}`
                      : vsPar(s, r.id)}
                </span>
              </div>
              <span className="font-display text-3xl font-extrabold tabular-nums">{r.total}</span>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
