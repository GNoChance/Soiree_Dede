import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { DoorOpen, Play, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { burst } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { getGame } from '@/games/registry'
import type { GameDefinition } from '@/games/types'
import type { WheelSpin } from './hostTools'

const SIZE = 300
const R = SIZE / 2
const SPIN_S = 5.5
/** « Réduire les animations » : la roue tourne quand même (c'est tout le jeu), plus calmement. */
const SPIN_CALM_S = 2.5

/**
 * Dessin de la roue sur un canvas 2D, tournée de `angleDeg` (sens horaire). Aucune transformation CSS, aucun
 * SVG animé, aucune bibliothèque d'animation : seulement notre boucle requestAnimationFrame (comme le bowling),
 * donc la roue tourne partout (iPhone, Android, « réduire les animations » activé, mode économie d'énergie).
 */
function drawWheel(canvas: HTMLCanvasElement, games: GameDefinition[], angleDeg: number) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = canvas.width / SIZE
  const css = getComputedStyle(canvas)
  const ink = css.getPropertyValue('--ink').trim() || '#1f1b2e'
  const surface = css.getPropertyValue('--surface').trim() || '#ffffff'
  const n = games.length
  const seg = 360 / Math.max(n, 1)
  const rad = (d: number) => (d * Math.PI) / 180
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, SIZE, SIZE)
  // ombre décalée « sticker » (ne tourne pas : la lumière vient toujours du même côté)
  ctx.fillStyle = ink
  ctx.beginPath()
  ctx.arc(R + 4, R + 4, R - 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.save()
  ctx.translate(R, R)
  ctx.rotate(rad(angleDeg))
  ctx.beginPath()
  ctx.arc(0, 0, R - 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3
  ctx.strokeStyle = ink
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `${n > 12 ? 22 : 30}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`
  games.forEach((g, i) => {
    const a0 = i * seg - 90 // 0° = en haut
    ctx.fillStyle = g.color
    ctx.beginPath()
    if (n === 1) ctx.arc(0, 0, R - 8, 0, Math.PI * 2)
    else {
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, R - 8, rad(a0), rad(a0 + seg))
      ctx.closePath()
    }
    ctx.fill()
    ctx.stroke()
    // emoji au milieu de la part, tête vers l'extérieur
    const mid = a0 + seg / 2
    ctx.save()
    ctx.translate(Math.cos(rad(mid)) * R * 0.66, Math.sin(rad(mid)) * R * 0.66)
    ctx.rotate(rad(mid + 90))
    ctx.fillStyle = ink
    ctx.fillText(g.emoji, 0, 0)
    ctx.restore()
  })
  // moyeu
  ctx.fillStyle = surface
  ctx.lineWidth = 4
  ctx.beginPath()
  ctx.arc(0, 0, 22, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  ctx.restore()
}

/** Ralentissement progressif (départ vif, arrêt doux). */
const easeOut = (p: number) => 1 - Math.pow(1 - p, 4)

/**
 * Roue des jeux plein écran : tout le monde la voit tourner et s'arrêter sur le même
 * jeu (le tirage vient du serveur). L'hôte peut « Lancer ce jeu » ou relancer.
 */
export function GameWheel({ spin, isHost, busy, onLaunch, onRespin, onClose, onGoSalon }: { spin: WheelSpin; isHost: boolean; busy: boolean; onLaunch: (gameId: string) => void; onRespin: () => void; onClose: () => void; /** Joueur hors du salon : bouton pour y retourner. */ onGoSalon?: () => void }) {
  const reduce = useReducedMotion()
  const games = useMemo(() => spin.game_ids.map((id) => getGame(id)).filter((g): g is GameDefinition => Boolean(g)), [spin.game_ids])
  const n = games.length
  const idx = Math.max(0, games.findIndex((g) => g.id === spin.result))
  const winner = games[idx]
  const [done, setDone] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const seg = 360 / Math.max(n, 1)
  // Le centre de la part gagnante finit sous le repère (en haut), avec un léger décalage dans la part.
  const jitter = (((spin.id * 37) % 100) / 100 - 0.5) * seg * 0.6
  const target = 360 * (reduce ? 2 : 6) - (idx + 0.5) * seg - jitter
  const spinS = reduce ? SPIN_CALM_S : SPIN_S

  useEffect(() => {
    let finished = false
    let raf = 0
    const canvas = canvasRef.current
    const finish = () => {
      if (finished) return
      finished = true
      if (canvas) drawWheel(canvas, games, target)
      setDone(true)
      fx.fanfare()
      burst({ x: 0.5, y: 0.5 }, 160)
    }
    setDone(false)
    if (canvas) drawWheel(canvas, games, 0)
    const start = performance.now()
    const frame = (now: number) => {
      const p = Math.min(1, (now - start) / (spinS * 1000))
      if (canvas) drawWheel(canvas, games, target * easeOut(p))
      if (p < 1) raf = requestAnimationFrame(frame)
      else finish()
    }
    raf = requestAnimationFrame(frame)
    // Filet : si la boucle est suspendue (onglet masqué…), on affiche quand même le résultat.
    const t = window.setTimeout(finish, spinS * 1000 + 600)
    // tic-tac pendant le tour
    const ticks = [0.4, 0.9, 1.5, 2.2, 3.0, 3.9, 4.8].map((s) => window.setTimeout(() => fx.tick(), (s / SPIN_S) * spinS * 1000))
    return () => {
      finished = true
      cancelAnimationFrame(raf)
      clearTimeout(t)
      ticks.forEach(clearTimeout)
    }
  }, [spin.id, spinS, games, target])
  if (!winner) return null
  const dpr = typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 3)
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#07050f]/75 p-4 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-label="Roue des jeux">
      <div className="flex max-h-[96dvh] w-full max-w-sm flex-col items-center gap-3 overflow-y-auto py-2">
        <h2 className="font-display text-3xl font-extrabold text-white drop-shadow-[3px_3px_0_var(--ink)]">🎡 La roue des jeux</h2>
        <div className="relative" style={{ width: SIZE, height: SIZE }}>
          <canvas key={spin.id} ref={canvasRef} width={Math.round(SIZE * dpr)} height={Math.round(SIZE * dpr)} style={{ width: SIZE, height: SIZE }} aria-hidden />
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
                  {onGoSalon && (
                    <Button size="lg" fullWidth icon={<DoorOpen className="size-6" />} onClick={onGoSalon}>
                      Aller au salon
                    </Button>
                  )}
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
