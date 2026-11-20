import { MarkLayer } from '@/features/solo/why/MarkLayer'
import type { DiagramProps } from '@/features/solo/why/types'
import { Piece } from './Piece'
import type { ChessBoard } from './types'

const LIGHT = '#f6e7c1'
const DARK = '#5fb3a6'

/** Petit plateau figé des Échecs (explication de fin de partie) : le camp du joueur en bas. */
export default function Diagram({ x, log, marks, blink }: DiagramProps) {
  const b = x.state.board as ChessBoard
  const flip = b.black === log.me
  const at = (i: number): [number, number] => (flip ? [7 - (i % 8), 7 - Math.floor(i / 8)] : [i % 8, Math.floor(i / 8)])
  const cells = Array.from({ length: 64 }, (_, k) => (flip ? 63 - k : k))
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[300px] rounded-card border-[3px] border-ink bg-ink p-1 shadow-sticker">
      <div className="relative grid size-full grid-cols-8 grid-rows-8 overflow-hidden rounded-[10px]">
        {cells.map((i) => {
          const dark = (Math.floor(i / 8) + (i % 8)) % 2 === 1
          const p = b.sq[i]
          return (
            <div key={i} className="relative flex items-center justify-center" style={{ background: dark ? DARK : LIGHT }}>
              {p && p !== '.' && <Piece piece={p} flat className="size-[86%]!" />}
            </div>
          )
        })}
        <MarkLayer marks={marks} cols={8} rows={8} at={at} blink={blink} />
      </div>
    </div>
  )
}
