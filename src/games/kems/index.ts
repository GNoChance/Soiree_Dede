import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { KemsOptionsPanel } from './Options'
import { KEMS_DEFAULT_OPTIONS, prepareKemsStart } from './setup'
import type { KemsState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'kems',
  order: 230,
  name: 'Kems',
  tagline: 'Réunissez quatre cartes identiques… et prévenez votre coéquipier en secret !',
  emoji: '🤠',
  color: '#FF9F43',
  minPlayers: 4,
  maxPlayers: 9,
  rules:
    'En équipes de 2, face à face. Tout le monde échange ses cartes avec celles du centre, en même temps. Dès que quelqu’un a quatre cartes identiques, il fait en douce le signe secret de son équipe : son coéquipier crie KEMS ! Un adversaire a repéré le signe ? Il crie CONTRE-KEMS ! Une erreur et ce sont les autres qui marquent.',
  Play,
  tv: true,
  Options: KemsOptionsPanel,
  Summary,
  defaultOptions: { ...KEMS_DEFAULT_OPTIONS },
  prepareStart: (options, ctx) => prepareKemsStart(options, ctx.playerIds),
  roundLabel: (s: BaseGameState) => {
    const k = s as unknown as KemsState
    return k.round > 0 && k.phase !== 'finished' ? `Manche ${k.round}` : null
  },
}
