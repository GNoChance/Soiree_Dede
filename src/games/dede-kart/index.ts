import { lazy, type ComponentType } from 'react'
import type { BaseGameState, GameDefinition, GamePlayProps, GameSummaryProps } from '../types'
import { DK_DEFAULT_OPTIONS, KartOptions, normalizeOptions } from './Options'

// Play charge la scène 3D (three) en différé.
const Play = lazy(() => import('./Play')) as ComponentType<GamePlayProps>
const Summary = lazy(() => import('./Summary')) as ComponentType<GameSummaryProps>

export const definition: GameDefinition = {
  id: 'dede-kart',
  order: 200,
  name: 'Dédé Kart',
  tagline: 'Tous sur la grille : drift, turbo et coups bas entre potes !',
  emoji: '🏎️',
  color: '#FF8C42',
  minPlayers: 2,
  maxPlayers: 12,
  rules:
    'Course de karts, chacun sur son téléphone. Le kart accélère tout seul : pose le doigt à gauche ou à droite pour tourner (lâche l’écran, il se remet droit tout seul). Dans un grand virage, il dérape tout seul et charge un mini-turbo (bleu, orange, violet) : redresse pour le déclencher ! Roule sur les boîtes « ? » pour gagner un objet, et touche le bouton OBJET pour l’utiliser. Six circuits, chacun avec ses pièges (flaques, obstacles qui traversent) et son raccourci étroit signalé par un portique violet : plus court, mais gare à la sortie de route ! Colle-toi derrière un kart pour profiter de l’aspiration. Points à chaque course, le meilleur total gagne la coupe.',
  Play,
  Options: KartOptions,
  Summary,
  defaultOptions: { ...DK_DEFAULT_OPTIONS },
  prepareStart: async (options) => normalizeOptions(options),
  roundLabel: (s: BaseGameState) => {
    const r = (s as unknown as { races?: number }).races
    return r && r > 1 ? `Coupe ${r} courses` : '1 course'
  },
}
