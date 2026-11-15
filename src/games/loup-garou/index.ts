import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { LoupGarouOptions } from './Options'
import { prepareLoupGarouStart } from './setup'
import { LG_DEFAULT_OPTIONS, LG_MAX_PLAYERS, LG_MIN_PLAYERS, type LgState } from './types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'loup-garou',
  order: 70,
  name: 'Loup-garou',
  tagline: 'La nuit, les loups dévorent. Le jour, le village accuse. Qui ment autour de la table ?',
  emoji: '🐺',
  color: '#5B4B8A',
  minPlayers: LG_MIN_PLAYERS,
  maxPlayers: LG_MAX_PLAYERS,
  rules:
    'Chacun reçoit un rôle secret. La nuit, tout le monde ferme les yeux et touche son écran : les loups choisissent une victime, les rôles spéciaux agissent en douce. Le jour, débattez puis votez pour éliminer un suspect. Le village gagne s’il élimine tous les loups ; les loups, s’ils deviennent aussi nombreux que les villageois.',
  Play,
  Options: LoupGarouOptions,
  Summary,
  defaultOptions: { ...LG_DEFAULT_OPTIONS },
  prepareStart: prepareLoupGarouStart,
  roundLabel: (s: BaseGameState) => {
    const st = s as unknown as LgState
    if (st.phase === 'roles') return 'Distribution des rôles'
    if (!st.night) return null
    if (st.phase === 'night') return `Nuit ${st.night}`
    if (st.phase === 'reveal' && st.reveal?.kind === 'dawn') return `Aube ${st.night}`
    return `Jour ${st.night}`
  },
}
