import type { ComponentType } from 'react'

/** Props passees au composant Play d'un jeu. Phase 2 pourra les enrichir (state, secret, players...). */
export interface GamePlayProps {
  matchId: string
  soireeId?: string
  /** Quitter la partie / retour au salon */
  onExit?: () => void
}

/** Props passees au composant d'options (ecran de lancement par l'hote). */
export interface GameOptionsProps {
  options: Record<string, unknown>
  onChange: (options: Record<string, unknown>) => void
  playerCount: number
}

export interface GameDefinition {
  /** 'qui-de-nous' | 'undercover' */
  id: string
  name: string
  tagline: string
  emoji: string
  /** Couleur d'accent de la carte */
  color: string
  minPlayers: number
  maxPlayers: number
  Play: ComponentType<GamePlayProps>
  Options?: ComponentType<GameOptionsProps>
}
