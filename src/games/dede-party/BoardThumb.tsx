import { CELL_INFO, isJump, linksOf, type BoardDef } from './board'

/** Mini-plan du tracé d'un plateau (une pastille par case, couleur du type), pour les options. */
export function BoardThumb({ board, className }: { board: BoardDef; className?: string }) {
  return (
    <svg className={className} viewBox={`-0.6 -0.6 ${board.cols + 0.2} ${board.rows + 0.2}`} aria-hidden>
      {linksOf(board)
        .filter(([a, b]) => !isJump(board, a, b))
        .map(([a, b]) => (
          <line key={`${a}-${b}`} x1={board.xy[a][0]} y1={board.xy[a][1]} x2={board.xy[b][0]} y2={board.xy[b][1]} stroke="var(--ink)" strokeWidth={0.22} strokeLinecap="round" />
        ))}
      {board.cells.map((t, i) => (
        <circle key={i} cx={board.xy[i][0]} cy={board.xy[i][1]} r={0.36} fill={CELL_INFO[t].color} stroke="var(--ink)" strokeWidth={0.12} />
      ))}
    </svg>
  )
}
