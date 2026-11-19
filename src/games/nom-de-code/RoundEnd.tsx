import { useEffect } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { burst } from '@/components/ui/confetti'
import { fx } from '@/lib/feedback'
import { TEAM_INFO } from '@/features/teams/teams'
import type { GamePlayProps, PlayerInfo } from '../types'
import { Grid } from './Grid'
import { ndcActions } from './setup'
import type { NdcState } from './types'

/** Fin de manche : grille entièrement dévoilée, bandeau du vainqueur, score des manches, « Manche suivante ». */
export function RoundEnd({
  s,
  meId,
  isHost,
  act,
  pending,
  players,
}: {
  s: NdcState
  meId: string
  isHost: boolean
  act: GamePlayProps['act']
  pending: boolean
  players: Record<string, PlayerInfo>
}) {
  const w = s.round_winner
  const win = w ? TEAM_INFO[w] : null
  const bombed = s.teams.find((t) => t.eliminated && s.round_end_reason === 'bomb')
  useEffect(() => {
    fx.success()
    burst({ x: 0.5, y: 0.3 }, 90)
  }, [s.round])

  const headline = !win
    ? 'Fin de la manche'
    : s.round_end_reason === 'bomb'
      ? `💣 Boum ! Les ${bombed ? TEAM_INFO[bombed.id].short : '…'} ont touché la bombe : les ${win.short} gagnent !`
      : s.round_end_reason === 'last_team'
        ? `${win.emoji} Les ${win.short}, dernière équipe en jeu, gagnent !`
        : `${win.emoji} Les ${win.short} ont trouvé tous leurs mots !`

  return (
    <div className="flex flex-col gap-3">
      <motion.p
        initial={{ scale: 0.6, rotate: -4 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 10 }}
        className="sticker rounded-card p-3 text-center font-display text-2xl font-extrabold"
        style={win ? { backgroundColor: win.soft, color: '#1f1b2e' } : undefined}
      >
        {headline}
      </motion.p>
      <Grid s={s} secretKey={s.key} meId={meId} canVote={false} onVote={() => undefined} players={players} />
      {s.total_rounds > 1 && (
        <div className="flex flex-wrap justify-center gap-2">
          {s.teams.map((t) => (
            <span key={t.id} className="sticker-sm rounded-full px-3 py-1 font-display font-extrabold" style={{ backgroundColor: TEAM_INFO[t.id].soft, color: '#1f1b2e' }}>
              {TEAM_INFO[t.id].emoji} {s.round_wins[t.id] ?? 0}
            </span>
          ))}
          <span className="w-full text-center text-sm text-muted">
            Manche {s.round}/{s.total_rounds}
          </span>
        </div>
      )}
      {s.phase === 'round_end' &&
        (isHost ? (
          <Button fullWidth size="lg" icon={<ArrowRight className="size-5" />} disabled={pending} onClick={() => void act(ndcActions.nextRound())}>
            Manche suivante
          </Button>
        ) : (
          <p className="text-center text-sm font-bold text-muted">L’hôte lance la manche suivante…</p>
        ))}
    </div>
  )
}
