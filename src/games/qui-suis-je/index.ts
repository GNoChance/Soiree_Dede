import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { QuiSuisJeOptions } from './Options'
import { QSJ_DEFAULT_OPTIONS, prepareQsjStart } from './setup'
import type { QsjState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'qui-suis-je',
  order: 120,
  name: 'Qui suis-je ?',
  tagline: 'Le téléphone sur le front, une star à l’écran, et tes amis qui miment comme des fous.',
  emoji: '🙈',
  color: '#FF8FA3',
  minPlayers: 2,
  maxPlayers: 9,
  rules: 'Chacun son tour, pose ton téléphone sur ton front, écran vers les autres : ils te font deviner la carte à l’oral. Incline vers le bas si tu as trouvé, vers le haut pour passer. Un maximum de cartes avant la fin du chrono !',
  Play,
  Options: QuiSuisJeOptions,
  Summary,
  defaultOptions: { ...QSJ_DEFAULT_OPTIONS, themes: [...QSJ_DEFAULT_OPTIONS.themes] },
  prepareStart: (options, ctx) => prepareQsjStart(options, ctx.playerIds.length),
  roundLabel: (s: BaseGameState) => {
    const q = s as unknown as QsjState
    return q.turn && q.total_turns ? `Tour ${q.turn}/${q.total_turns}` : null
  },
}
