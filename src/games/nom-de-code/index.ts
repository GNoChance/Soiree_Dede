import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { NdcOptionsPanel } from './Options'
import { NDC_DEFAULT_OPTIONS, prepareNdcStart } from './setup'
import type { NdcState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'nom-de-code',
  order: 210,
  name: 'Nom de Code',
  tagline: 'Un espion, un mot, un nombre : retrouvez vos mots… sans toucher la bombe !',
  emoji: '🔐',
  color: '#5EE6A8',
  minPlayers: 4,
  maxPlayers: 9,
  rules:
    'En équipes, l’espion voit quels mots sont les vôtres et donne un indice d’un seul mot avec un nombre. L’équipe pose ses têtes sur les mots : la majorité dévoile. Trouvez tous vos mots avant les autres… et gare à la bombe 💣 !',
  Play,
  tv: true,
  Options: NdcOptionsPanel,
  Summary,
  defaultOptions: { ...NDC_DEFAULT_OPTIONS },
  prepareStart: (options, ctx) => prepareNdcStart(options, ctx.playerIds),
  roundLabel: (s: BaseGameState) => {
    const t = s as unknown as NdcState
    return t.total_rounds > 1 ? `Manche ${t.round}/${t.total_rounds}` : null
  },
}
