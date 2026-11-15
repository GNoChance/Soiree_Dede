import type { GameDefinition } from './types'
import { Play as QuiDeNousPlay } from './qui-de-nous/Play'
import { Play as UndercoverPlay } from './undercover/Play'

export const GAMES: GameDefinition[] = [
  {
    id: 'qui-de-nous',
    name: 'Qui de nous ?',
    tagline: 'Votez pour l\'ami qui correspond le mieux. Soyez dans la majorité !',
    emoji: '🫵',
    color: '#FF8FA3',
    minPlayers: 3,
    maxPlayers: 9,
    Play: QuiDeNousPlay,
  },
  {
    id: 'undercover',
    name: 'Undercover',
    tagline: 'Un mot différent se cache parmi vous. Démasquez l\'infiltré !',
    emoji: '🕵️',
    color: '#8B5CF6',
    minPlayers: 3,
    maxPlayers: 9,
    Play: UndercoverPlay,
  },
]

export const getGame = (id: string): GameDefinition | undefined => GAMES.find((g) => g.id === id)
