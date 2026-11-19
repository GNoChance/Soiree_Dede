import { motion, useReducedMotion } from 'framer-motion'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import { playerOrPlaceholder } from '@/features/soiree/players'
import { TEAM_INFO } from '@/features/teams/teams'
import type { PlayerInfo } from '../types'
import type { NdcCell, NdcState } from './types'

const NEUTRAL = '#eadfc8'
const BOMB = '#1f1b2e'

/** Fond léger (couleur secrète) d'une carte non dévoilée, vue par l'espion ou en fin de manche. */
function tint(c: NdcCell): { background: string; color: string } {
  if (c === 'neutral') return { background: '#f6efe0', color: '#1f1b2e' }
  if (c === 'bomb') return { background: '#4a4458', color: '#ffffff' }
  return { background: TEAM_INFO[c].soft, color: '#1f1b2e' }
}

/**
 * Grille 5×5. Carte dévoilée = retournée et colorée (équipe : couleur + chibi d'un membre ;
 * neutre : beige ; bombe : 💥). Têtes posées (votes de l'équipe active) en bas de carte.
 * Toucher sa propre carte votée retire sa tête.
 */
export function Grid({
  s,
  secretKey,
  meId,
  canVote,
  onVote,
  players,
}: {
  s: NdcState
  secretKey: NdcCell[] | null
  meId: string
  canVote: boolean
  onVote: (index: number | null) => void
  players: Record<string, PlayerInfo>
}) {
  const reduce = useReducedMotion()
  const myVote = s.votes[meId]
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {s.words.map((w, i) => {
        const rev = s.revealed[String(i)]
        const heads = Object.entries(s.votes).filter(([, v]) => v === i).map(([pid]) => pid)
        const mine = myVote === i
        const secret = !rev && secretKey ? tint(secretKey[i]) : null
        let style: React.CSSProperties | undefined = secret ?? undefined
        let face: React.ReactNode = null
        if (rev) {
          if (rev.color === 'neutral') style = { background: NEUTRAL, color: '#1f1b2e' }
          else if (rev.color === 'bomb') {
            style = { background: BOMB, color: '#ffffff' }
            face = <span className="text-2xl leading-none">💥</span>
          } else {
            style = { background: TEAM_INFO[rev.color].color, color: TEAM_INFO[rev.color].text }
            const owner = s.teams.find((t) => t.id === rev.color)?.players[0]
            if (owner) face = <Avatar slug={playerOrPlaceholder(players, owner).slug} size={26} />
          }
        }
        return (
          <motion.button
            key={`${s.round}-${i}`}
            type="button"
            disabled={!canVote || Boolean(rev)}
            onClick={() => onVote(mine ? null : i)}
            initial={false}
            animate={rev && !reduce ? { rotateY: [90, 0], scale: [1.08, 1] } : { rotateY: 0 }}
            transition={{ duration: 0.45 }}
            whileTap={canVote && !rev ? { scale: 0.92 } : undefined}
            style={style}
            className={cn(
              'relative flex aspect-[4/5] flex-col items-center justify-center gap-0.5 overflow-hidden rounded-chip border-[3px] border-ink px-0.5 text-center',
              !style && 'bg-surface text-text',
              mine && 'ring-4 ring-sun',
              rev && 'opacity-95',
            )}
            aria-label={rev ? `${w} (dévoilé)` : `${w}${mine ? ' (ta tête)' : ''}`}
          >
            {face}
            <span className={cn('w-full break-words font-display font-extrabold leading-tight', w.length > 7 ? 'text-[10px]' : 'text-xs')}>{w}</span>
            {secret && secretKey?.[i] === 'bomb' && <span className="absolute top-0.5 right-0.5 text-xs">💣</span>}
            {heads.length > 0 && (
              <span className="absolute bottom-0.5 left-0 flex w-full justify-center -space-x-1.5">
                {heads.slice(0, 4).map((pid) => (
                  <Avatar key={pid} slug={playerOrPlaceholder(players, pid).slug} size={18} />
                ))}
              </span>
            )}
          </motion.button>
        )
      })}
    </div>
  )
}
