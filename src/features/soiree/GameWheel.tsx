import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Play, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { burst } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { getGame } from '@/games/registry'
import type { GameDefinition } from '@/games/types'
import type { WheelSpin } from './hostTools'

const SIZE = 300
const R = SIZE / 2
const SPIN_S = 5.5

function polar(angleDeg: number, r: number) {
  const a = ((angleDeg - 90) * Math.PI) / 180
  return [R + r * Math.cos(a), R + r * Math.sin(a)] as const
}

/**
 * Roue des jeux plein écran : tout le monde la voit tourner et s'arrêter sur le même
 * jeu (le tirage vient du serveur). L'hôte peut « Lancer ce jeu » ou relancer.
 */
export function GameWheel({ spin, isHost, busy, onLaunch, onRespin, onClose }: { spin: WheelSpin; isHost: boolean; busy: boolean; onLaunch: (gameId: string) => void; onRespin: () => void; onClose: () => void }) {
  const reduce = useReducedMotion()
  const games = useMemo(() => spin.game_ids.map((id) => getGame(id)).filter((g): g is GameDefinition => Boolean(g)), [spin.game_ids])
  const n = games.length
  const idx = Math.max(0, games.findIndex((g) => g.id === spin.result))
  const winner = games[idx]
  const [done, setDone] = useState(false)
  const seg = 360 / Math.max(n, 1)
  // Le centre de la part gagnante finit sous le repère (en haut), avec un léger décalage dans la part.
  const jitter = (((spin.id * 37) % 100) / 100 - 0.5) * seg * 0.6
  const target = 360 * 6 - (idx + 0.5) * seg - jitter

  const finished = useRef(false)
  const finishRef = useRef<() => void>(() => {})
  useEffect(() => {
    finished.current = false
    const finish = () => {
      if (finished.current) return
      finished.current = true
      setDone(true)
      fx.fanfare()
      burst({ x: 0.5, y: 0.5 }, 160)
    }
    finishRef.current = finish
    setDone(false)
    // Filet : si l'animation ne notifie pas la fin (onglet masqué…), on affiche quand même le résultat.
    const t = window.setTimeout(finish, (reduce ? 0.3 : SPIN_S) * 1000 + 600)
    // tic-tac pendant le tour
    const ticks = reduce ? [] : [0.4, 0.9, 1.5, 2.2, 3.0, 3.9, 4.8].map((s) => window.setTimeout(() => fx.tick(), s * 1000))
    return () => {
      clearTimeout(t)
      ticks.forEach(clearTimeout)
    }
  }, [spin.id, reduce])
  if (!winner) return null
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#07050f]/75 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Roue des jeux">
      <div className="flex max-h-[96dvh] w-full max-w-sm flex-col items-center gap-3 overflow-y-auto py-2">
        <h2 className="font-display text-3xl font-extrabold text-white drop-shadow-[3px_3px_0_var(--ink)]">🎡 La roue des jeux</h2>
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <motion.svg
            key={spin.id}
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            width={SIZE}
            height={SIZE}
            className="overflow-visible drop-shadow-[4px_4px_0_var(--ink)]"
            initial={{ rotate: 0 }}
            animate={{ rotate: reduce ? target % 360 : target }}
            transition={reduce ? { duration: 0.2 } : { duration: SPIN_S, ease: [0.12, 0.75, 0.15, 1] }}
            onAnimationComplete={() => finishRef.current()}
          >
            <circle cx={R} cy={R} r={R - 2} fill="var(--ink)" />
            {games.map((g, i) => {
              const a0 = i * seg
              const [x0, y0] = polar(a0, R - 8)
              const [x1, y1] = polar(a0 + seg, R - 8)
              const [ex, ey] = polar(a0 + seg / 2, R * 0.66)
              const path = n === 1 ? '' : `M${R} ${R} L${x0} ${y0} A${R - 8} ${R - 8} 0 ${seg > 180 ? 1 : 0} 1 ${x1} ${y1} Z`
              return (
                <g key={g.id}>
                  <path d={path} fill={g.color} stroke="var(--ink)" strokeWidth={3} strokeLinejoin="round" />
                  <text x={ex} y={ey} textAnchor="middle" dominantBaseline="central" fontSize={n > 12 ? 22 : 30} transform={`rotate(${a0 + seg / 2} ${ex} ${ey})`}>
                    {g.emoji}
                  </text>
                </g>
              )
            })}
            <circle cx={R} cy={R} r={22} fill="var(--surface)" stroke="var(--ink)" strokeWidth={4} />
          </motion.svg>
          {/* repère fixe */}
          <svg aria-hidden viewBox="0 0 40 40" width={40} height={40} className="absolute -top-3 left-1/2 -translate-x-1/2 drop-shadow-[2px_2px_0_var(--ink)]">
            <path d="M4 4 H36 L20 36 Z" fill="#EF476F" stroke="var(--ink)" strokeWidth={3.5} strokeLinejoin="round" />
          </svg>
        </div>

        <div className="min-h-[9.5rem] w-full">
          {done ? (
            <motion.div
              initial={{ scale: 0.4, rotate: -8, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 300, damping: 13 }}
              className="sticker flex flex-col items-center gap-2 p-3 text-center text-[#1f1b2e]"
              style={{ backgroundColor: winner.color }}
            >
              <p className="flex items-center gap-2 font-display text-2xl leading-tight font-extrabold">
                <span className="text-4xl">{winner.emoji}</span> {winner.name} !
              </p>
              <p className="text-sm leading-snug font-bold">{winner.tagline}</p>
              {isHost ? (
                <div className="flex w-full flex-col gap-2">
                  <Button size="lg" fullWidth disabled={busy} icon={<Play className="size-6 fill-current" />} onClick={() => onLaunch(winner.id)}>
                    Lancer ce jeu
                  </Button>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" className="flex-1" icon={<RotateCw className="size-4" />} onClick={onRespin}>
                      Relancer
                    </Button>
                    <Button size="sm" variant="secondary" className="flex-1" icon={<X className="size-4" />} onClick={onClose}>
                      Fermer
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex w-full flex-col gap-2">
                  <p className="font-display font-extrabold">L’hôte va lancer la partie…</p>
                  <Button size="sm" variant="secondary" onClick={onClose}>
                    Fermer
                  </Button>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.p className="pt-4 text-center font-display text-xl font-extrabold text-white" animate={reduce ? undefined : { scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 0.7 }}>
              Ça tourne…
            </motion.p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
