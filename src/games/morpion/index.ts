import { lazy, type ComponentType } from 'react'
import { makeDuelGame } from '@/features/duel/makeDuelGame'
import type { GamePlayProps, GameSummaryProps } from '../types'
import BoardOptions from './BoardOptions'
import { variantOf } from './logic'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

/**
 * « Morpion » — jeu en duel (socle src/features/duel + supabase/features/duel.sql),
 * 3 variantes au choix de l'hôte (options.board.variant) : classique 3×3,
 * géant 10×10 (aligner 5), ultime (9 petits morpions). SQL : supabase/games/morpion.sql.
 */
export const definition = makeDuelGame({
  id: 'morpion',
  order: 170,
  name: 'Morpion',
  tagline: 'Croix ou rond ? Aligne avant l’autre… en classique, en géant ou en ultime !',
  emoji: '❌',
  color: '#FFB703',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Duel à deux, chacun son tour : ❌ commence. Classique : aligne 3 symboles sur la grille 3×3. Géant : aligne-en 5 sur une grille 10×10. Ultime : 9 petits morpions dans un grand, ta case envoie l’adversaire dans le petit morpion correspondant ; gagne-en 3 alignés ! 30 s par coup. Les autres regardent et parient sur le vainqueur !',
  Play,
  Summary,
  BoardOptions,
  defaultBoardOptions: { variant: 'classic' },
  prepareBoard: (board) => ({ variant: variantOf(board) }),
})
