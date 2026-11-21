/** Jeux avec un « Mode entraînement » (route /entrainement/:gameId) : seul, sans soirée, rien n'est compté. */
export const TRAINING_GAME_IDS = ['mini-golf', 'bowling', 'dede-kart'] as const
export type TrainingGameId = (typeof TRAINING_GAME_IDS)[number]
export const isTrainingGame = (id: string | undefined | null): id is TrainingGameId =>
  !!id && (TRAINING_GAME_IDS as readonly string[]).includes(id)
