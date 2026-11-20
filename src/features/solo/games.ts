/**
 * Les 4 duels jouables seul contre un bot. Tout est chargé à la demande (moteur local,
 * bot, plateau du vrai jeu) pour ne rien ajouter au chargement de l'accueil.
 */
import type { ComponentType } from 'react'
import type { DuelBoardProps } from '@/features/duel/types'
import type { LocalDuelGame } from './engine'

export type BotMood = 'joie' | 'surprise' | null

export interface SoloGameModule {
  local: LocalDuelGame<unknown, unknown>
  Board: ComponentType<DuelBoardProps<unknown, unknown>>
  /** Options du plateau (ex. Morpion classique, Échecs sans pendule). */
  options: Record<string, unknown>
  /** Coup du bot (asynchrone : Web Worker pour 4 à la suite et Échecs). */
  chooseMove: (board: unknown, me: string, level: number) => Promise<unknown>
  reaction: (prev: unknown, next: unknown, by: string, bot: string) => BotMood
  /** Consigne quand c'est au joueur. */
  hint: (board: unknown, me: string) => string
  setupHint?: string
}

export const SOLO_GAME_IDS = ['morpion', 'quatre-a-la-suite', 'bataille-navale', 'echecs'] as const
export type SoloGameId = (typeof SOLO_GAME_IDS)[number]
export const isSoloGame = (id: string | undefined | null): id is SoloGameId => !!id && (SOLO_GAME_IDS as readonly string[]).includes(id)

type Any = never

export const SOLO_LOADERS: Record<SoloGameId, () => Promise<SoloGameModule>> = {
  morpion: async () => {
    const [{ local, soloHint }, bot, { default: Board }] = await Promise.all([
      import('@/games/morpion/local'),
      import('@/games/morpion/bot'),
      import('@/games/morpion/Board'),
    ])
    return {
      local: local as LocalDuelGame<unknown, unknown>,
      Board: Board as ComponentType<DuelBoardProps<unknown, unknown>>,
      options: { variant: 'classic' },
      chooseMove: async (b, me, level) => bot.chooseMove(b as Any, me, level),
      reaction: (p, n, by, id) => bot.reaction(p as Any, n as Any, by, id),
      hint: (b, me) => soloHint(b as Any, me),
    }
  },
  'quatre-a-la-suite': async () => {
    const [{ local }, bot, { default: Board }, { runInWorker }] = await Promise.all([
      import('@/games/quatre-a-la-suite/local'),
      import('@/games/quatre-a-la-suite/bot'),
      import('@/games/quatre-a-la-suite/Board'),
      import('./botRunner'),
    ])
    return {
      local: local as LocalDuelGame<unknown, unknown>,
      Board: Board as ComponentType<DuelBoardProps<unknown, unknown>>,
      options: {},
      chooseMove: (b, me, level) =>
        runInWorker({ game: 'quatre-a-la-suite', board: b, me, level }, () => bot.chooseMove(b as Any, me, level, Math.random, 300)),
      reaction: (p, n, by, id) => bot.reaction(p as Any, n as Any, by, id),
      hint: () => 'À toi : lâche un jeton !',
    }
  },
  'bataille-navale': async () => {
    const [{ local }, bot, { default: Board }] = await Promise.all([
      import('@/games/bataille-navale/local'),
      import('@/games/bataille-navale/bot'),
      import('@/games/bataille-navale/Board'),
    ])
    return {
      local: local as LocalDuelGame<unknown, unknown>,
      Board: Board as ComponentType<DuelBoardProps<unknown, unknown>>,
      options: {},
      chooseMove: async (b, me, level) => bot.chooseMove(b as Any, me, level),
      reaction: (p, n, by, id) => bot.reaction(p as Any, n as Any, by, id),
      hint: () => 'À toi : vise et fais feu ! 🎯',
      setupHint: 'Place ta flotte en secret, puis « Prêt ! » ⚓',
    }
  },
  echecs: async () => {
    const [{ local }, bot, { default: Board }, { runInWorker }] = await Promise.all([
      import('@/games/echecs/local'),
      import('@/games/echecs/bot'),
      import('@/games/echecs/Board'),
      import('./botRunner'),
    ])
    return {
      local: local as LocalDuelGame<unknown, unknown>,
      Board: Board as ComponentType<DuelBoardProps<unknown, unknown>>,
      options: { cadence: 'none' },
      chooseMove: (b, me, level) => runInWorker({ game: 'echecs', board: b, me, level }, () => bot.chooseMove(b as Any, me, level, Math.random, 300)),
      reaction: (p, n, by, id) => bot.reaction(p as Any, n as Any, by, id),
      hint: () => 'À toi : touche une pièce !',
    }
  },
}
