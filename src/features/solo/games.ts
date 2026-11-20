/**
 * Les 4 duels jouables seul contre un bot. Tout est chargé à la demande (moteur local,
 * bot, plateau du vrai jeu, apprentissage ; explications et petit plateau en fin de partie)
 * pour ne rien ajouter au chargement de l'accueil.
 */
import type { ComponentType } from 'react'
import type { DuelBoardProps } from '@/features/duel/types'
import type { LocalDuelGame } from './engine'
import type { Side, SoloLog } from './log'
import type { GameLearner, MemBase } from './memory'
import type { DiagramProps, GameWhy, Moment } from './why/types'

/** `appris` : le bot vient de jouer un coup appris (« Je te connais ! 💡 »). */
export type BotMood = 'joie' | 'surprise' | 'appris' | null

/** Coup du bot ; `learned` = id de l'habitude qui a décidé du coup (2b). */
export interface BotChoice {
  move: unknown
  learned?: string
}

export interface WhyKit {
  why: GameWhy
  Diagram: ComponentType<DiagramProps>
}

export interface SoloGameModule {
  local: LocalDuelGame<unknown, unknown>
  Board: ComponentType<DuelBoardProps<unknown, unknown>>
  /** Options du plateau (ex. Morpion classique, Échecs sans pendule). */
  options: Record<string, unknown>
  /** Coup du bot (asynchrone : Web Worker pour 4 à la suite et Échecs). Sans `hints` : jeu de l'étape 1. */
  chooseMove: (board: unknown, me: string, level: number, hints?: unknown) => Promise<BotChoice>
  reaction: (prev: unknown, next: unknown, by: string, bot: string) => BotMood
  /** Consigne quand c'est au joueur. */
  hint: (board: unknown, me: string) => string
  setupHint?: string
  /** 2b : mémoire du bot pour ce jeu. */
  learner: GameLearner<MemBase, unknown>
  /** 2a : phrases + petit plateau (chargés en fin de partie). */
  loadWhy: () => Promise<WhyKit>
  /** 2a : moments clés (Web Worker pour 4 à la suite et Échecs). */
  findMoments: (log: SoloLog, loser: Side) => Promise<Moment[]>
}

export const SOLO_GAME_IDS = ['morpion', 'quatre-a-la-suite', 'bataille-navale', 'echecs'] as const
export type SoloGameId = (typeof SOLO_GAME_IDS)[number]
export const isSoloGame = (id: string | undefined | null): id is SoloGameId => !!id && (SOLO_GAME_IDS as readonly string[]).includes(id)

type Any = never
type AnyLearner = GameLearner<MemBase, unknown>

/** Analyse de 4 à la suite / Échecs : 1,5 s au plus dans le worker, repli direct plus court. */
const WHY_BUDGET = { 'quatre-a-la-suite': 400, echecs: 1500 } as const

export const SOLO_LOADERS: Record<SoloGameId, () => Promise<SoloGameModule>> = {
  morpion: async () => {
    const [{ local, soloHint }, bot, { default: Board }, { learner }] = await Promise.all([
      import('@/games/morpion/local'),
      import('@/games/morpion/bot'),
      import('@/games/morpion/Board'),
      import('@/games/morpion/learn'),
    ])
    const loadWhy = async (): Promise<WhyKit> => {
      const [{ why }, { default: Diagram }] = await Promise.all([import('@/games/morpion/why'), import('@/games/morpion/Diagram')])
      return { why, Diagram }
    }
    return {
      local: local as LocalDuelGame<unknown, unknown>,
      Board: Board as ComponentType<DuelBoardProps<unknown, unknown>>,
      options: { variant: 'classic' },
      chooseMove: async (b, me, level, hints) => bot.decide(b as Any, me, level, Math.random, hints as Any),
      reaction: (p, n, by, id) => bot.reaction(p as Any, n as Any, by, id),
      hint: (b, me) => soloHint(b as Any, me),
      learner: learner as unknown as AnyLearner,
      loadWhy,
      findMoments: async (log, loser) => (await loadWhy()).why.findMoments(log, loser),
    }
  },
  'quatre-a-la-suite': async () => {
    const [{ local }, bot, { default: Board }, { runInWorker, runJob }, { learner }] = await Promise.all([
      import('@/games/quatre-a-la-suite/local'),
      import('@/games/quatre-a-la-suite/bot'),
      import('@/games/quatre-a-la-suite/Board'),
      import('./botRunner'),
      import('@/games/quatre-a-la-suite/learn'),
    ])
    const loadWhy = async (): Promise<WhyKit> => {
      const [{ why }, { default: Diagram }] = await Promise.all([import('@/games/quatre-a-la-suite/why'), import('@/games/quatre-a-la-suite/Diagram')])
      return { why, Diagram }
    }
    return {
      local: local as LocalDuelGame<unknown, unknown>,
      Board: Board as ComponentType<DuelBoardProps<unknown, unknown>>,
      options: {},
      chooseMove: (b, me, level, hints) =>
        runInWorker({ game: 'quatre-a-la-suite', board: b, me, level, hints }, () => bot.decide(b as Any, me, level, Math.random, 300, hints as Any)),
      reaction: (p, n, by, id) => bot.reaction(p as Any, n as Any, by, id),
      hint: () => 'À toi : lâche un jeton !',
      learner: learner as unknown as AnyLearner,
      loadWhy,
      findMoments: (log, loser) =>
        runJob<Moment[]>(
          { kind: 'why', game: 'quatre-a-la-suite', log, loser, budget: WHY_BUDGET['quatre-a-la-suite'] },
          (r) => (Array.isArray(r.moments) ? (r.moments as Moment[]) : undefined),
          async () => (await loadWhy()).why.findMoments(log, loser, 150),
        ),
    }
  },
  'bataille-navale': async () => {
    const [{ local }, bot, { default: Board }, { learner }] = await Promise.all([
      import('@/games/bataille-navale/local'),
      import('@/games/bataille-navale/bot'),
      import('@/games/bataille-navale/Board'),
      import('@/games/bataille-navale/learn'),
    ])
    const loadWhy = async (): Promise<WhyKit> => {
      const [{ why }, { default: Diagram }] = await Promise.all([import('@/games/bataille-navale/why'), import('@/games/bataille-navale/Diagram')])
      return { why, Diagram }
    }
    return {
      local: local as LocalDuelGame<unknown, unknown>,
      Board: Board as ComponentType<DuelBoardProps<unknown, unknown>>,
      options: {},
      chooseMove: async (b, me, level, hints) => bot.decide(b as Any, me, level, Math.random, hints as Any),
      reaction: (p, n, by, id) => bot.reaction(p as Any, n as Any, by, id),
      hint: () => 'À toi : vise et fais feu ! 🎯',
      setupHint: 'Place ta flotte en secret, puis « Prêt ! » ⚓',
      learner: learner as unknown as AnyLearner,
      loadWhy,
      findMoments: async (log, loser) => (await loadWhy()).why.findMoments(log, loser),
    }
  },
  echecs: async () => {
    const [{ local }, bot, { default: Board }, { runInWorker, runJob }, { learner }] = await Promise.all([
      import('@/games/echecs/local'),
      import('@/games/echecs/bot'),
      import('@/games/echecs/Board'),
      import('./botRunner'),
      import('@/games/echecs/learn'),
    ])
    const loadWhy = async (): Promise<WhyKit> => {
      const [{ why }, { default: Diagram }] = await Promise.all([import('@/games/echecs/why'), import('@/games/echecs/Diagram')])
      return { why, Diagram }
    }
    return {
      local: local as LocalDuelGame<unknown, unknown>,
      Board: Board as ComponentType<DuelBoardProps<unknown, unknown>>,
      options: { cadence: 'none' },
      chooseMove: (b, me, level, hints) =>
        runInWorker({ game: 'echecs', board: b, me, level, hints }, () => bot.decide(b as Any, me, level, Math.random, 300, hints as Any)),
      reaction: (p, n, by, id) => bot.reaction(p as Any, n as Any, by, id),
      hint: () => 'À toi : touche une pièce !',
      learner: learner as unknown as AnyLearner,
      loadWhy,
      findMoments: (log, loser) =>
        runJob<Moment[]>(
          { kind: 'why', game: 'echecs', log, loser, budget: WHY_BUDGET.echecs },
          (r) => (Array.isArray(r.moments) ? (r.moments as Moment[]) : undefined),
          async () => (await loadWhy()).why.findMoments(log, loser, 400),
          5000,
        ),
    }
  },
}
