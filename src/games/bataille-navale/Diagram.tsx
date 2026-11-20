import { MarkLayer } from '@/features/solo/why/MarkLayer'
import type { DiagramProps, Mark } from '@/features/solo/why/types'
import { Sea, type SeaShip } from './Sea'
import type { BnBoard, BnShip } from './types'
import { OWN } from './why'

/**
 * Petit plateau figé de la Bataille navale : les eaux du bot avec les tirs du joueur
 * (cases 0..99), ou — si les marques visent les cases + 100 — les eaux du joueur avec
 * sa flotte et les tirs du bot (flotte prévisible, bateaux collés).
 */
export default function Diagram({ x, log, marks, colors, blink }: DiagramProps) {
  const b = x.state.board as BnBoard
  const own = marks.some((m) => m.cells.some((c) => c >= OWN))
  const owner = own ? log.me : log.bot
  const color = owner === b.a ? colors.a : colors.b
  const w = b.waters[owner]
  const sunk = new Set((w?.sunk ?? []).map((s) => s.id))
  let ships: SeaShip[]
  if (own) {
    const fleet = (b.reveal?.[log.me] ?? (x.secrets[log.me] as { fleet?: BnShip[] } | undefined)?.fleet ?? []) as BnShip[]
    ships = fleet.map((s) => ({ ship: s, look: sunk.has(s.id) ? 'sunk' : 'afloat', accent: color }))
  } else {
    ships = (w?.sunk ?? []).map((s) => ({ ship: s, look: 'sunk' as const, accent: color }))
  }
  const shown: Mark[] = marks.map((m) => ({ ...m, cells: m.cells.map((c) => (c >= OWN ? c - OWN : c)) }))
  return (
    <div className="mx-auto w-full max-w-[260px]">
      <p className="mb-1 text-center font-display text-sm font-extrabold text-muted">{own ? 'Ta flotte (mes tirs)' : 'Mes eaux (tes tirs)'}</p>
      <Sea
        shots={w?.shots ?? []}
        ships={ships}
        size="sm"
        label={own ? 'Ta flotte' : 'Mes eaux'}
        fog={<MarkLayer marks={shown} cols={10} rows={10} at={(c) => [c % 10, Math.floor(c / 10)]} blink={blink} />}
      />
    </div>
  )
}
