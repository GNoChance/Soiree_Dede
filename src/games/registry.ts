import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from './types'
import { QuiDeNousOptions } from './qui-de-nous/Options'
import { QDN_DEFAULT_OPTIONS, prepareQuiDeNousStart } from './qui-de-nous/setup'
import { UndercoverOptions } from './undercover/Options'
import { UC_DEFAULT_OPTIONS, prepareUndercoverStart } from './undercover/setup'

// Les écrans de jeu sont chargés à la demande (bundle principal plus léger).
const QuiDeNousPlay = lazy(() => import('./qui-de-nous/Play')) as ComponentType<GamePlayProps>
const QuiDeNousSummary = lazy(() => import('./qui-de-nous/Summary')) as ComponentType<GameSummaryProps>
const UndercoverPlay = lazy(() => import('./undercover/Play')) as ComponentType<GamePlayProps>
const UndercoverSummary = lazy(() => import('./undercover/Summary')) as ComponentType<GameSummaryProps>

export const GAMES: GameDefinition[] = [
  {
    id: 'qui-de-nous',
    name: 'Qui de nous ?',
    tagline: 'Qui finirait les restes du frigo à 3 h du mat’ ? Votez, et visez la majorité !',
    emoji: '🫵',
    color: '#FF8FA3',
    minPlayers: 3,
    maxPlayers: 9,
    rules: 'Une question s’affiche : chacun désigne en secret le joueur qui y correspond le mieux. 1 point si tu votes comme la majorité !',
    Play: QuiDeNousPlay,
    Options: QuiDeNousOptions,
    Summary: QuiDeNousSummary,
    defaultOptions: QDN_DEFAULT_OPTIONS,
    prepareStart: (options) => prepareQuiDeNousStart(options),
    roundLabel: (s: BaseGameState) => (s.round ? `Question ${s.round}/${s.total_rounds ?? '?'}` : null),
  },
  {
    id: 'undercover',
    name: 'Undercover',
    tagline: 'Un mot presque pareil se cache parmi vous… Démasquez l’infiltré sans vous trahir !',
    emoji: '🕵️',
    color: '#8B5CF6',
    minPlayers: 3,
    maxPlayers: 9,
    rules: 'Chacun reçoit un mot secret, mais l’infiltré a un mot voisin. Décrivez le vôtre à l’oral en un mot, puis votez pour éliminer le suspect.',
    Play: UndercoverPlay,
    Options: UndercoverOptions,
    Summary: UndercoverSummary,
    defaultOptions: UC_DEFAULT_OPTIONS,
    prepareStart: (options) => prepareUndercoverStart(options),
    roundLabel: (s: BaseGameState) => (s.round ? `Manche ${s.round}` : null),
  },
]

export const getGame = (id: string): GameDefinition | undefined => GAMES.find((g) => g.id === id)
