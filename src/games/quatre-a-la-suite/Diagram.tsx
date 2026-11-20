import { MarkLayer } from '@/features/solo/why/MarkLayer'
import type { DiagramProps } from '@/features/solo/why/types'
import { Token } from './Board'
import type { Q4Board } from './types'

const W = 7
const H = 6

/** Petit plateau figé de « 4 à la suite » (explication de fin de partie) : 7 × 6 + marques. */
export default function Diagram({ x, marks, me, bot, colors, blink }: DiagramProps) {
  const b = x.state.board as Q4Board
  const colorOf = (id: string) => (id === b.a ? colors.a : colors.b)
  return (
    <div
      className="relative mx-auto w-full max-w-[300px] rounded-[1.2rem] border-[3px] border-ink p-1.5 shadow-sticker"
      style={{ background: 'linear-gradient(160deg, #6d5cf0 0%, #4a37c9 60%, #3a2aa6 100%)' }}
    >
      <div className="relative grid aspect-[7/6] w-full grid-cols-7 grid-rows-6">
        {Array.from({ length: H }, (_, y) =>
          Array.from({ length: W }, (_, c) => {
            const r = H - 1 - y
            const who = b.cols[c]?.[r]
            return (
              <div key={`${c}-${r}`} className="relative p-[7%]">
                <div className="relative size-full rounded-full bg-paper shadow-[inset_2px_2px_0_rgba(0,0,0,0.25)]">
                  {who && <Token color={colorOf(who)} player={who === bot.id ? bot : me} className="absolute inset-0" />}
                </div>
              </div>
            )
          }),
        )}
        <MarkLayer marks={marks} cols={W} rows={H} at={(cell) => [Math.floor(cell / H), H - 1 - (cell % H)]} blink={blink} />
      </div>
    </div>
  )
}
