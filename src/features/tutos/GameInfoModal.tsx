import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { TENUES } from '@/data/tenues'
import type { GameDefinition } from '@/games/types'
import { TutoButton } from './TutoButton'

/**
 * Fiche d'un jeu consultable hors soirée (depuis le hub) : règles, vidéo
 * « Comment on joue ? » (si elle existe) et tenue à gagner.
 */
export function GameInfoModal({ game, onClose }: { game: GameDefinition | null; onClose: () => void }) {
  const tenue = game ? TENUES.find((t) => t.gameId === game.id) : undefined
  return (
    <Modal open={!!game} onClose={onClose} title={game ? `${game.emoji} ${game.name}` : undefined}>
      {game && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge tone="neutral">{game.minPlayers}-{game.maxPlayers} joueurs</Badge>
          </div>
          <p className="text-lg font-bold leading-snug">{game.tagline}</p>
          {game.rules && (
            <div className="rounded-2xl border-[3px] border-ink p-3" style={{ background: `${game.color}33` }}>
              <p className="mb-1 font-display text-sm font-extrabold uppercase tracking-wide">📜 Les règles</p>
              <p className="leading-snug">{game.rules}</p>
            </div>
          )}
          <TutoButton gameId={game.id} gameName={game.name} className="self-stretch" />
          {tenue && (
            <p className="text-sm text-muted">
              {tenue.emoji} Tenue à gagner : <b>{tenue.label}</b> ({tenue.condition})
            </p>
          )}
          <p className="text-sm text-muted">Pour jouer, lance une soirée depuis l’accueil !</p>
          <Button onClick={onClose}>Compris !</Button>
        </div>
      )}
    </Modal>
  )
}
