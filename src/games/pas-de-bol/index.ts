import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { PasDeBolOptions } from './Options'
import { PDB_DEFAULT_OPTIONS, preparePasDeBolStart } from './rules'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'pas-de-bol',
  order: 30,
  name: 'Pas de bol !',
  tagline: 'Vide ta main avant les autres… le dernier avec des cartes a vraiment pas de bol !',
  emoji: '🃏',
  color: '#FB8500',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Pose une carte de la même couleur ou du même symbole, sinon pioche. Les +2 et +4 se cumulent ! Crie « Dernière carte ! » quand il ne t’en reste qu’une, sinon gare à la dénonciation. Le dernier joueur avec des cartes perd.',
  Play,
  Options: PasDeBolOptions,
  Summary,
  defaultOptions: PDB_DEFAULT_OPTIONS,
  prepareStart: (options) => preparePasDeBolStart(options),
  roundLabel: (s: BaseGameState) => {
    const active = (s as unknown as { active?: string[] }).active
    return Array.isArray(active) && s.phase === 'playing' ? `${active.length} en lice` : null
  },
}
