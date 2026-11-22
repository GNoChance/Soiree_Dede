import { Link } from 'react-router'
import { Toggle } from '@/components/ui/Toggle'
import { type CardGame, useCardCount } from './api'

/**
 * Option « Cartes de la bande » des écrans de lancement (Tu préfères, Action ou vérité, Qui de nous).
 * Activée par défaut ; sans effet tant que personne n'a écrit de carte.
 */
export function CustomCardsOption({ game, checked, onChange }: { game: CardGame; checked: boolean; onChange: (v: boolean) => void }) {
  const count = useCardCount(game)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-display text-lg font-extrabold">Cartes de la bande ✍️</span>
          <span className="text-sm text-muted">
            {count === null
              ? 'Chargement…'
              : count === 0
                ? 'Aucune carte pour l’instant'
                : `${count} carte${count > 1 ? 's' : ''} écrite${count > 1 ? 's' : ''} par vous (1 sur 3 au plus)`}
          </span>
        </div>
        <Toggle checked={checked} onChange={onChange} label="Cartes de la bande" />
      </div>
      <Link to={`/cartes?jeu=${game}`} className="w-fit font-display text-sm font-extrabold text-grape underline decoration-2 underline-offset-2">
        {count ? 'Écrire mes propres cartes →' : 'Écrire la première carte →'}
      </Link>
    </div>
  )
}
