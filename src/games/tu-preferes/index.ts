import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { TuPreferesOptions } from './Options'
import { TP_DEFAULT_OPTIONS, prepareTuPreferesStart } from './setup'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'tu-preferes',
  order: 110,
  name: 'Tu préfères ?',
  tagline: 'Spaghettis à la place des mains ou saucisses à la place des pieds ? Et surtout : que choisira la majorité ?',
  emoji: '🤔',
  color: '#C4B5FD',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Un dilemme, deux choix secrets : ce que TU préfères, puis ce que préférera la MAJORITÉ. 1 point si ton pari est juste (égalité parfaite : personne ne marque). Bonus Rebelle : +1 si tu es le seul de ton avis !',
  Play,
  tv: true,
  Options: TuPreferesOptions,
  Summary,
  defaultOptions: { ...TP_DEFAULT_OPTIONS },
  prepareStart: (options) => prepareTuPreferesStart(options),
  roundLabel: (s: BaseGameState) => (s.round ? `Dilemme ${s.round}/${s.total_rounds ?? '?'}` : null),
}
