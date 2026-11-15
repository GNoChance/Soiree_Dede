import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { BombeOptions } from './Options'
import { BAM_DEFAULT_OPTIONS, prepareBombeStart } from './setup'
import type { BamState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'bombe-a-mots',
  order: 80,
  name: 'Bombe à mots',
  tagline: 'Un mot avec la syllabe, vite, avant le BOUM !',
  emoji: '💣',
  color: '#EF476F',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'La bombe tourne autour de la table : quand elle est sur toi, tape un mot qui contient la syllabe affichée avant qu’elle explose (personne ne sait quand !). BOUM = une vie en moins. Utilise toutes les lettres de ton alphabet bonus pour regagner une vie. Dernier debout gagne !',
  Play,
  Options: BombeOptions,
  Summary,
  defaultOptions: { ...BAM_DEFAULT_OPTIONS },
  prepareStart: (options) => prepareBombeStart(options),
  roundLabel: (s: BaseGameState) => {
    const b = s as unknown as BamState
    return typeof b.words_count === 'number' ? `${b.words_count} mot${b.words_count > 1 ? 's' : ''} · niv. ${b.level ?? 1}` : null
  },
}
