import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Piece } from './Piece'

/* Fiche « Les pièces » : comment se déplace chaque pièce, en une mini-image chacune (grille 5 × 5). */

type Mark = 'dot' | 'ring'

function marksFor(p: string): Map<number, Mark> {
  const m = new Map<number, Mark>()
  const add = (r: number, c: number, k: Mark = 'dot') => {
    if (r >= 0 && r < 5 && c >= 0 && c < 5 && !(r === 2 && c === 2)) m.set(r * 5 + c, k)
  }
  const ray = (dr: number, dc: number) => {
    for (let k = 1; k < 3; k++) add(2 + dr * k, 2 + dc * k)
  }
  if (p === 'p') {
    add(1, 2)
    add(0, 2)
    add(1, 1, 'ring')
    add(1, 3, 'ring')
  } else if (p === 'n') {
    for (const [dr, dc] of [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]]) add(2 + dr, 2 + dc)
  } else if (p === 'k') {
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) add(2 + dr, 2 + dc)
  } else {
    const straight = p === 'r' || p === 'q'
    const diag = p === 'b' || p === 'q'
    if (straight) for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ray(dr, dc)
    if (diag) for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) ray(dr, dc)
  }
  return m
}

function Mini({ piece, extra }: { piece: string; extra?: Record<number, string> }) {
  const marks = marksFor(piece)
  return (
    <div className="grid w-[4.5rem] shrink-0 grid-cols-5 overflow-hidden rounded-md border-2 border-ink">
      {Array.from({ length: 25 }, (_, i) => {
        const dark = (Math.floor(i / 5) + (i % 5)) % 2 === 1
        const mk = marks.get(i)
        return (
          <div key={i} className="relative aspect-square" style={{ background: dark ? '#5fb3a6' : '#f6e7c1' }}>
            {i === 12 && <Piece piece={piece.toUpperCase()} flat className="absolute inset-[4%]" />}
            {extra?.[i] && <Piece piece={extra[i]} flat className="absolute inset-[10%]" />}
            {mk === 'dot' && <span className="absolute inset-[34%] rounded-full bg-[#1f1b2e]/45" />}
            {mk === 'ring' && <span className="absolute inset-[6%] rounded-full border-[3px] border-tomato" />}
          </div>
        )
      })}
    </div>
  )
}

const PIECES: Array<{ p: string; name: string; text: string; extra?: Record<number, string> }> = [
  { p: 'p', name: 'Le pion', text: 'Avance tout droit d’une case (deux au premier coup). Il prend en diagonale, vers l’avant.', extra: { 6: 'p', 8: 'p' } },
  { p: 'n', name: 'Le cavalier', text: 'Saute en « L » : deux cases puis une sur le côté. Le seul qui passe par-dessus les autres !' },
  { p: 'b', name: 'Le fou', text: 'Glisse en diagonale, aussi loin qu’il veut, sans sauter.' },
  { p: 'r', name: 'La tour', text: 'Glisse en ligne droite (rangée ou colonne), aussi loin qu’elle veut.' },
  { p: 'q', name: 'La dame', text: 'Tour + fou : toutes les directions, aussi loin qu’elle veut. La pièce la plus forte.' },
  { p: 'k', name: 'Le roi', text: 'Une case dans toutes les directions. S’il est attaqué : « Échec ! ». S’il ne peut plus s’échapper : échec et mat, partie perdue.' },
]

const SPECIAL = [
  { emoji: '🏰', name: 'Le roque', text: 'Le roi glisse de deux cases vers une tour, qui saute de l’autre côté. Seulement si ni le roi ni cette tour n’ont bougé, que rien n’est entre eux et que le roi n’est ni en échec ni ne passe par une case attaquée. Touche ton roi : la case s’allume si c’est possible.' },
  { emoji: '👑', name: 'La promotion', text: 'Un pion qui arrive tout au bout devient la pièce de ton choix (souvent une dame !).' },
  { emoji: '👻', name: 'La prise en passant', text: 'Un pion adverse avance de deux cases et s’arrête juste à côté du tien ? Tu peux le prendre comme s’il n’avait avancé que d’une case… mais seulement au coup suivant.' },
  { emoji: '🤝', name: 'Les nuls', text: 'Pat (plus aucun coup possible sans être en échec), 3 fois la même position, 50 coups sans prise ni coup de pion, ou plus assez de pièces pour mater : match nul.' },
]

/** Bouton « ❓ Les pièces » + fiche repliable. */
export function Aide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center justify-center gap-1 self-center rounded-full border-[3px] border-ink bg-sky px-3 py-1 font-display font-extrabold text-[#1f1b2e] shadow-sticker-sm"
      >
        ❓ Les pièces <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div key="aide" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="sticker flex flex-col gap-2 bg-surface p-3">
              {PIECES.map((x) => (
                <div key={x.p} className="flex items-center gap-3">
                  <Mini piece={x.p} extra={x.extra} />
                  <p className="text-sm leading-snug">
                    <span className="font-display font-extrabold">{x.name} : </span>
                    {x.text}
                  </p>
                </div>
              ))}
              <hr className="border-t-2 border-dashed border-ink/20" />
              {SPECIAL.map((x) => (
                <p key={x.name} className="text-sm leading-snug">
                  <span className="mr-1 text-lg">{x.emoji}</span>
                  <span className="font-display font-extrabold">{x.name} : </span>
                  {x.text}
                </p>
              ))}
              <p className="text-xs text-muted">Pas d’inquiétude : seules les cases possibles s’allument, impossible de jouer un coup interdit.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
