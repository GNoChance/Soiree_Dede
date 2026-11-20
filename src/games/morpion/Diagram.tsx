import { MarkLayer } from '@/features/solo/why/MarkLayer'
import type { DiagramProps } from '@/features/solo/why/types'
import { Mark } from './Mark'
import type { MorpionBoard } from './types'

/** Petit plateau figé du Morpion (explication de fin de partie) : grille 3 × 3 + marques. */
export default function Diagram({ x, marks, colors, blink }: DiagramProps) {
  const b = x.state.board as MorpionBoard
  const colorOf = (id: string) => (id === b.a ? colors.a : colors.b)
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[240px] rounded-card border-[3px] border-ink bg-surface p-1.5 shadow-sticker">
      <div className="relative grid size-full grid-cols-3 grid-rows-3">
        {b.cells.map((v, i) => (
          <div
            key={i}
            className="relative flex items-center justify-center border-ink/70"
            style={{ borderRightWidth: i % 3 < 2 ? 3 : 0, borderBottomWidth: i < 6 ? 3 : 0 }}
          >
            {v && <Mark sym={v} color={colorOf(v === 'x' ? b.x : b.o)} className="size-[78%]!" weight={10} />}
          </div>
        ))}
        <MarkLayer marks={marks} cols={3} rows={3} at={(c) => [c % 3, Math.floor(c / 3)]} blink={blink} />
      </div>
    </div>
  )
}
