import { lazy, type ComponentType } from 'react'
import { makeDuelGame } from '@/features/duel/makeDuelGame'
import type { GamePlayProps, GameSummaryProps } from '../types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

/**
 * « 4 à la suite » — premier jeu bâti sur le socle duel (src/features/duel,
 * supabase/features/duel.sql). Options = DuelOptions (mode Roi / Tournoi /
 * Duel), prepareStart et roundLabel fournis par makeDuelGame.
 */
export const definition = makeDuelGame({
  id: 'quatre-a-la-suite',
  order: 160,
  name: '4 à la suite',
  tagline: 'Lâche tes jetons, bloque l’adversaire… et aligne-en 4 avant lui !',
  emoji: '🔴',
  color: '#EF476F',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Duel à deux sur une grille de 7 colonnes : à tour de rôle, lâche un jeton qui tombe tout en bas. Le premier qui en aligne 4 (ligne, colonne ou diagonale) gagne ; grille pleine = nul. 30 s par coup. Les autres regardent et parient sur le vainqueur !',
  Play,
  Summary,
})
