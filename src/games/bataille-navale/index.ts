import { lazy, type ComponentType } from 'react'
import { makeDuelGame } from '@/features/duel/makeDuelGame'
import type { GamePlayProps, GameSummaryProps } from '../types'

const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

/**
 * « Bataille navale » — jeu en duel (socle src/features/duel,
 * supabase/features/duel.sql) avec préparation simultanée de 60 s (flottes
 * secrètes), puis tirs « touché, rejoue ». SQL : supabase/games/bataille-navale.sql.
 */
export const definition = makeDuelGame({
  id: 'bataille-navale',
  order: 180,
  name: 'Bataille navale',
  tagline: 'Touché… coulé ! Traque la flotte adverse avant qu’elle ne coule la tienne.',
  emoji: '🚢',
  color: '#3A86FF',
  minPlayers: 2,
  maxPlayers: 9,
  rules:
    'Duel à deux sur une grille de 10 × 10. En 60 s, place ta flotte en secret (5 bateaux : mélange 🎲 ou glisse-les, touche pour pivoter). Puis tirez chacun votre tour : « À l’eau » = main à l’adversaire, « Touché ! » ou « Coulé ! » = tu rejoues. Le premier qui coule toute la flotte adverse gagne. 30 s par tir. Les autres regardent les deux grilles et parient !',
  Play,
  Summary,
})
