import type { GameDefinition } from './types'

/**
 * Registre auto-découvert : chaque dossier src/games/<id>/index.ts exporte
 * `definition: GameDefinition`. Ajouter un jeu = créer ce dossier (+ son SQL
 * dans supabase/games/<id>.sql). Aucun fichier partagé à modifier.
 */
const modules = import.meta.glob<{ definition: GameDefinition }>('./*/index.ts', { eager: true })

export const GAMES: GameDefinition[] = Object.values(modules)
  .map((m) => m.definition)
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.name.localeCompare(b.name))

export const getGame = (id: string): GameDefinition | undefined => GAMES.find((g) => g.id === id)
