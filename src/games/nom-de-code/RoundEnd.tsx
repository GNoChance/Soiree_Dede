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

/** Bandeau de fin de manche (aussi affiché dans le résumé de fin de partie). */
export function roundHeadline(s: NdcState): string {
  const w = s.round_winner
  const win = w ? TEAM_INFO[w] : null
  const bombed = s.teams.find((t) => t.eliminated && s.round_end_reason === 'bomb')
  // Équipe qui a touché la bombe (lue sur la carte dévoilée) : à 3 ou 4 équipes, c'est elle qu'il faut nommer.
  const bombBy = Object.values(s.revealed).find((r) => r.color === 'bomb')?.by
  if (!win) return 'Fin de la manche'
  if (s.round_end_reason === 'bomb') return `💣 Boum ! Les ${bombed ? TEAM_INFO[bombed.id].short : '…'} ont touché la bombe : les ${win.short} gagnent !`
  if (s.round_end_reason === 'last_team') return `${bombBy ? `💣 Les ${TEAM_INFO[bombBy].short} sont éliminés ! ` : ''}${win.emoji} Les ${win.short}, dernière équipe en jeu, gagnent !`
  return `${win.emoji} Les ${win.short} ont trouvé tous leurs mots !`
}

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
  const headline = roundHeadline(s)
  useEffect(() => {
    fx.success()
    burst({ x: 0.5, y: 0.3 }, 90)
  }, [s.round])

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
