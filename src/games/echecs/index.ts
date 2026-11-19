import { lazy, type ComponentType } from 'react'
import { makeDuelGame } from '@/features/duel/makeDuelGame'
import type { GamePlayProps, GameSummaryProps } from '../types'
import BoardOptions from './BoardOptions'
import { cadenceOf } from './logic'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

/**
 * « Échecs » — jeu en duel (socle src/features/duel + supabase/features/duel.sql).
 * Règles officielles complètes vérifiées par le serveur (supabase/games/echecs.sql),
 * coups légaux publiés dans le plateau ; pendule par joueur (options.board.cadence).
 * Format proposé : Duel (une session « roi » d'échecs serait trop longue).
 */
export const definition = makeDuelGame({
  id: 'echecs',
  order: 220,
  name: 'Échecs',
  tagline: 'Les vraies échecs, sans prise de tête : touche une pièce, les cases possibles s’allument !',
  emoji: '♟️',
  color: '#2A9D8F',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Duel à deux, les Blancs commencent. Touche une de tes pièces : ses cases possibles s’allument, touche la case pour jouer. Mets le roi adverse échec et mat pour gagner ! Pat, 3 fois la même position, 50 coups sans prise ou plus assez de pièces : match nul. Pendule de 5 min par joueur (temps écoulé = perdu), ou 3 / 10 min, ou sans pendule (60 s par coup). Tu peux proposer nul ou abandonner. Les autres regardent et parient !',
  Play,
  Summary,
  BoardOptions,
  defaultBoardOptions: { cadence: 'rapid5' },
  defaultMode: 'duel',
  prepareBoard: (board) => ({ cadence: cadenceOf(board) }),
})
