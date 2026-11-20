import { motion, useReducedMotion } from 'framer-motion'
import type { Mark } from './types'

/**
 * Calque des marques du petit plateau figé, commun aux 4 jeux (cases carrées) :
 * couleurs ET formes (daltoniens) — rouge + croix = ton coup ; vert + anneau + flèche = le
 * bon coup (clignote à l'étape ②) ; jaune + pointillés = ma menace ; ligne = alignement ;
 * zone = cases surlignées. Le plateau du jeu place ce calque en `absolute inset-0` sur la grille.
 */
export const MARK_COLORS = { played: '#EF476F', better: '#06D6A0', threat: '#FFB703', line: '#FFB703', zone: '#FFB703' } as const
/** Contours : couleur du texte (encre en clair, clair en sombre) pour rester lisibles dans les deux thèmes. */
const INK = 'var(--text, #1f1b2e)'
const U = 10 // unités du viewBox par case

export function MarkLayer({
  marks,
  cols,
  rows,
  at,
  blink = false,
}: {
  marks: readonly Mark[]
  cols: number
  rows: number
  /** Case -> [colonne, ligne] à l'écran (0, 0 = en haut à gauche). */
  at: (cell: number) => [number, number]
  blink?: boolean
}) {
  const reduce = useReducedMotion()
  const c = (cell: number): [number, number] => {
    const [x, y] = at(cell)
    return [(x + 0.5) * U, (y + 0.5) * U]
  }
  const pulse = blink && !reduce ? { animate: { opacity: [1, 0.25, 1] }, transition: { repeat: Infinity, duration: 0.9 } } : {}
  const order: Record<Mark['kind'], number> = { zone: 0, line: 1, threat: 2, played: 3, better: 4 }
  const sorted = [...marks].sort((p, q) => order[p.kind] - order[q.kind])
  return (
    <svg viewBox={`0 0 ${cols * U} ${rows * U}`} className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
      <defs>
        {(['better', 'threat'] as const).map((k) => (
          <marker key={k} id={`why-arrow-${k}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="3.2" markerHeight="3.2" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill={MARK_COLORS[k]} stroke={INK} strokeWidth="1.4" />
          </marker>
        ))}
      </defs>
      {sorted.map((m, mi) => {
        const col = MARK_COLORS[m.kind]
        const key = `${m.kind}-${mi}`
        if (m.kind === 'zone')
          return (
            <g key={key}>
              {m.cells.map((cell) => {
                const [x, y] = at(cell)
                return <rect key={cell} x={x * U + 0.6} y={y * U + 0.6} width={U - 1.2} height={U - 1.2} rx={1.6} fill={col} fillOpacity={0.45} stroke={INK} strokeWidth={0.5} strokeDasharray="1.4 1" />
              })}
            </g>
          )
        if (m.kind === 'line') {
          if (m.cells.length < 2) return null
          const pts = m.cells.map(c)
          // du plus éloigné au plus éloigné (les cases peuvent arriver dans le désordre)
          let best: [number, number] = [0, 1]
          let dmax = -1
          for (let i = 0; i < pts.length; i++)
            for (let j = i + 1; j < pts.length; j++) {
              const d = (pts[i][0] - pts[j][0]) ** 2 + (pts[i][1] - pts[j][1]) ** 2
              if (d > dmax) {
                dmax = d
                best = [i, j]
              }
            }
          const [a, b] = [pts[best[0]], pts[best[1]]]
          return (
            <g key={key}>
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={INK} strokeWidth={3.4} strokeLinecap="round" opacity={0.85} />
              <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={col} strokeWidth={2} strokeLinecap="round" />
            </g>
          )
        }
        const shapes = m.cells.map((cell) => {
          const [x, y] = c(cell)
          if (m.kind === 'played')
            return (
              <g key={cell}>
                <rect x={x - 4.4} y={y - 4.4} width={8.8} height={8.8} rx={1.6} fill="none" stroke={INK} strokeWidth={2.4} />
                <rect x={x - 4.4} y={y - 4.4} width={8.8} height={8.8} rx={1.6} fill="none" stroke={col} strokeWidth={1.3} />
                <g stroke={INK} strokeWidth={2.6} strokeLinecap="round">
                  <path d={`M ${x + 2} ${y - 4.6} l 3 3 M ${x + 5} ${y - 4.6} l -3 3`} />
                </g>
                <g stroke={col} strokeWidth={1.2} strokeLinecap="round">
                  <path d={`M ${x + 2} ${y - 4.6} l 3 3 M ${x + 5} ${y - 4.6} l -3 3`} />
                </g>
              </g>
            )
          if (m.kind === 'threat')
            return (
              <g key={cell}>
                <circle cx={x} cy={y} r={4.1} fill={col} fillOpacity={0.4} stroke={INK} strokeWidth={1.9} strokeDasharray="1.6 1.1" />
                <circle cx={x} cy={y} r={4.1} fill="none" stroke={col} strokeWidth={0.9} strokeDasharray="1.6 1.1" />
              </g>
            )
          return (
            <motion.g key={cell} {...pulse}>
              <circle cx={x} cy={y} r={4.2} fill={col} fillOpacity={0.3} stroke={INK} strokeWidth={2.6} />
              <circle cx={x} cy={y} r={4.2} fill="none" stroke={col} strokeWidth={1.4} />
            </motion.g>
          )
        })
        const arrow =
          m.arrow &&
          (() => {
            const [a, b] = [c(m.arrow[0]), c(m.arrow[1])]
            const dx = b[0] - a[0]
            const dy = b[1] - a[1]
            const len = Math.hypot(dx, dy) || 1
            const end: [number, number] = [b[0] - (dx / len) * 3.2, b[1] - (dy / len) * 3.2]
            const k = m.kind === 'better' ? 'better' : 'threat'
            return (
              <motion.g key="arrow" {...(m.kind === 'better' ? pulse : {})}>
                <line x1={a[0]} y1={a[1]} x2={end[0]} y2={end[1]} stroke={INK} strokeWidth={3} strokeLinecap="round" />
                <line
                  x1={a[0]}
                  y1={a[1]}
                  x2={end[0]}
                  y2={end[1]}
                  stroke={MARK_COLORS[k]}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeDasharray={m.kind === 'threat' ? '2 1.2' : undefined}
                  markerEnd={`url(#why-arrow-${k})`}
                />
              </motion.g>
            )
          })()
        return (
          <g key={key}>
            {shapes}
            {arrow}
          </g>
        )
      })}
    </svg>
  )
}
