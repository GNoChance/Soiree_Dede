import { memo, useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ChibiImage } from '@/components/ui/ChibiImage'
import { mood, pickExpression } from '@/features/soiree/players'
import { fx } from '@/lib/feedback'
import { cn } from '@/lib/cn'
import type { DuelBoardProps } from '@/features/duel/types'
import type { PlayerInfo } from '@/games/types'
import { HEIGHT, WIDTH, dropRow, lineKeys } from './logic'
import { playClack } from './sound'
import type { Q4Board, Q4Move } from './types'

/* -------------------------------------------------------------------------- */
/* Jeton « sticker » avec mini-chibi                                           */
/* -------------------------------------------------------------------------- */

interface TokenProps {
  color: string
  player: PlayerInfo
  expression?: string
  win?: boolean
  dim?: boolean
  ghost?: boolean
  className?: string
}

export const Token = memo(function Token({ color, player, expression, win, dim, ghost, className }: TokenProps) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={cn(
        'relative flex size-full items-center justify-center overflow-hidden rounded-full border-[3px] border-ink',
        ghost && 'opacity-60',
        dim && 'opacity-40 saturate-50',
        className,
      )}
      style={{ background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${color} 55%, white) 0%, ${color} 55%, color-mix(in srgb, ${color} 75%, black) 100%)` }}
      animate={win && !reduce ? { scale: [1, 1.14, 1], filter: ['brightness(1)', 'brightness(1.45)', 'brightness(1)'] } : undefined}
      transition={win ? { repeat: Infinity, duration: 0.6, ease: 'easeInOut' } : undefined}
    >
      {/* anneau intérieur façon jeton moulé */}
      <span className="pointer-events-none absolute inset-[12%] rounded-full border-2 border-white/40" aria-hidden />
      <ChibiImage slug={player.slug} expression={expression ?? player.equipped} tenue={player.equippedTenue} size={40} thumb bare className="relative mt-[12%] h-[78%]! w-[78%]!" />
      {win && <span className="pointer-events-none absolute inset-0 rounded-full ring-4 ring-sun ring-inset" aria-hidden />}
    </motion.div>
  )
})

/* -------------------------------------------------------------------------- */
/* Plateau                                                                     */
/* -------------------------------------------------------------------------- */

/** Plateau de « 4 à la suite » (7 × 6). Souris : survol + clic ; tactile : toucher pour viser, retoucher pour lâcher. */
export default function Q4BoardView({ board, me, isMyTurn, onMove, pending, phase, get, colors }: DuelBoardProps<Q4Board, Q4Move>) {
  const reduce = useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)
  const [armed, setArmed] = useState<number | null>(null)
  const pointerType = useRef<string>('mouse')
  const win = lineKeys(board.line)
  const finished = phase === 'result'
  const interactive = isMyTurn && !pending && phase === 'playing'
  const colorOf = (id: string) => (id === board.a ? colors.a : colors.b)
  const target = interactive ? (armed ?? hover) : null
  const meP = get(me)

  // Le visé n'a plus de sens quand le tour passe.
  const armedKey = `${board.count}-${isMyTurn}`
  const [lastArmedKey, setLastArmedKey] = useState(armedKey)
  if (armedKey !== lastArmedKey) {
    setLastArmedKey(armedKey)
    setArmed(null)
  }

  // « Clac » à l'atterrissage de chaque nouveau jeton.
  const lastCount = useRef(board.count)
  useEffect(() => {
    if (board.count > lastCount.current && board.last) playClack(HEIGHT - board.last.row, reduce ? 0 : 0.2)
    lastCount.current = board.count
  }, [board.count, board.last, reduce])

  const play = (c: number) => {
    if (!interactive || dropRow(board.cols, c) === null) return
    setArmed(null)
    onMove({ col: c })
  }
  const onColumn = (c: number) => {
    if (!interactive) return
    if (dropRow(board.cols, c) === null) {
      fx.fail()
      return
    }
    if (pointerType.current === 'mouse' || armed === c) play(c)
    else {
      fx.tick()
      setArmed(c)
    }
  }

  const lineOwner = board.line?.length ? board.cols[board.line[0][0]][board.line[0][1]] : null

  return (
    <div className="mx-auto flex w-full max-w-[26rem] flex-col gap-1 select-none">
      {/* Rangée de visée : jeton fantôme au-dessus de la colonne visée */}
      <div className="grid grid-cols-7 gap-[3%] px-[3.5%]" aria-hidden>
        {Array.from({ length: WIDTH }, (_, c) => (
          <div key={c} className="relative aspect-square">
            {target === c && (
              <motion.div
                layoutId="q4-ghost"
                className="size-full"
                animate={reduce ? undefined : { y: [0, -5, 0] }}
                transition={{ y: { repeat: Infinity, duration: 0.8 }, layout: { type: 'spring', stiffness: 600, damping: 30 } }}
              >
                <Token color={colorOf(me)} player={meP} ghost />
              </motion.div>
            )}
          </div>
        ))}
      </div>

      {/* Cadre */}
      <div
        className="relative rounded-[1.6rem] border-[4px] border-ink p-[3%] shadow-sticker-lg"
        style={{ background: 'linear-gradient(160deg, #6d5cf0 0%, #4a37c9 60%, #3a2aa6 100%)' }}
        onPointerLeave={() => setHover(null)}
      >
        <div className="grid grid-cols-7 gap-[3%]">
          {Array.from({ length: WIDTH }, (_, c) => {
            const full = dropRow(board.cols, c) === null
            const hl = target === c && !full
            return (
              <button
                key={c}
                type="button"
                aria-label={`Colonne ${c + 1}${full ? ' (pleine)' : ''}`}
                disabled={!interactive}
                onPointerDown={(e) => {
                  pointerType.current = e.pointerType
                }}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') setHover(c)
                }}
                onClick={() => onColumn(c)}
                className={cn(
                  'relative flex flex-col-reverse gap-1 overflow-hidden rounded-full p-[4%] transition-colors',
                  interactive ? (full ? 'cursor-not-allowed' : 'cursor-pointer') : 'cursor-default',
                  hl && 'bg-white/25',
                )}
              >
                {Array.from({ length: HEIGHT }, (_, r) => {
                  const owner = board.cols[c]?.[r] ?? null
                  const isLast = !!board.last && board.last.col === c && board.last.row === r
                  const winning = win.has(`${c},${r}`)
                  const p = owner ? get(owner) : null
                  return (
                    <div key={r} className="relative aspect-square w-full rounded-full bg-paper shadow-[inset_3px_3px_0_rgba(0,0,0,0.25)]">
                      {owner && p && (
                        <motion.div
                          key={`${c}-${r}-${owner}`}
                          className="absolute inset-0"
                          initial={isLast && !reduce ? { y: `-${(HEIGHT - r) * 105 + 30}%` } : false}
                          animate={{ y: 0 }}
                          transition={{ type: 'spring', stiffness: 520, damping: 13, mass: 0.9 }}
                        >
                          <Token
                            color={colorOf(owner)}
                            player={p}
                            expression={
                              finished && lineOwner
                                ? owner === lineOwner
                                  ? pickExpression(p, 'cool', 'pouces', 'joie')
                                  : mood(p, 'sad')
                                : undefined
                            }
                            win={finished && winning}
                            dim={finished && !!board.line && !winning}
                          />
                          {isLast && !finished && <span className="absolute -top-1 -right-1 size-3 rounded-full border-2 border-ink bg-sun" aria-hidden />}
                        </motion.div>
                      )}
                    </div>
                  )
                })}
              </button>
            )
          })}
        </div>
      </div>

      {interactive && armed !== null && (
        <p className="text-center text-sm font-extrabold">Retouche la colonne {armed + 1} pour lâcher le jeton ⬇️</p>
      )}
      {!interactive && phase === 'playing' && !isMyTurn && board.count === 0 && (
        <p className="text-center text-xs text-muted">Aligne 4 jetons (ligne, colonne ou diagonale) pour gagner la manche.</p>
      )}
    </div>
  )
}
