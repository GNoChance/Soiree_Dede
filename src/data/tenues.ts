/**
 * Catalogue des tenues (miroir de la table `tenues`, supabase/features/tenues.sql).
 * Une tenue = variante du chibi : public/chibis/<slug>/<tenue>/<expression>.webp.
 * Pour ajouter une tenue : une ligne ici + une ligne dans tenues.sql (+ la planche, cf. tools/slice-chibis/README.md).
 */

export type TenueId = 'default' | 'star' | 'espion' | 'croupier' | 'prof' | 'ecolier' | 'artiste' | 'loup' | 'artificier' | 'pirate' | 'bowler' | 'philosophe' | 'vedette' | 'archer' | 'comedien' | 'coach' | 'stratege' | 'ninja' | 'amiral'

export interface TenueDef {
  id: TenueId
  label: string
  emoji: string
  /** Jeu dont il faut gagner des parties (null = tenue de base / aucun jeu précis). */
  gameId: string | null
  /** Nom du jeu pour les textes de progression. */
  gameName?: string
  /** Victoires requises (condition 'game_wins'). */
  threshold: number
  /** Condition de déblocage (texte FR). */
  condition: string
  /** « victoires à Undercover » -> « 3/10 victoires à Undercover » */
  unit?: string
  /** true = jeu en duel : chaque duel remporté compte (condition 'duel_wins'). */
  duel?: boolean
  /** Dossier des illustrations (public/chibis/<slug>/<art>/ + portraits/<art>.webp) ; absent = pas d'illustration. */
  art?: string
  /** true = débloquée d'office */
  default?: boolean
}

const wins = (id: TenueId, label: string, emoji: string, gameId: string, gameName: string, threshold = 10): TenueDef => ({
  id,
  label,
  emoji,
  gameId,
  gameName,
  threshold,
  condition: `${threshold} victoires à ${gameName}`,
  unit: `victoires à ${gameName}`,
})

/** Jeux en duel : chaque duel remporté compte (pas seulement la session). */
const duels = (id: TenueId, label: string, emoji: string, gameId: string, gameName: string, threshold = 10): TenueDef => ({
  ...wins(id, label, emoji, gameId, gameName, threshold),
  duel: true,
  condition: `${threshold} duels gagnés à ${gameName}`,
  unit: `duels gagnés à ${gameName}`,
})

export const DEFAULT_TENUE: TenueId = 'default'

export const TENUES: TenueDef[] = [
  { id: 'default', label: 'Tenue de soirée', emoji: '🎉', gameId: null, threshold: 0, condition: 'Débloquée d\'office', default: true, art: 'default' },
  { ...wins('star', 'Star', '🌟', 'qui-de-nous', 'Qui de nous ?'), art: 'cinema' },
  { ...wins('espion', 'Espion', '🕵️', 'undercover', 'Undercover'), art: 'spy' },
  { ...wins('croupier', 'Croupier', '🃏', 'pas-de-bol', 'Pas de bol !'), art: 'croupier' },
  { ...wins('prof', 'Prof', '🎓', 'cerveau-en-fete', 'Cerveau en fête'), art: 'student' },
  { ...wins('ecolier', 'Écolier', '🎒', 'petit-bac', 'Petit bac'), art: 'student' },
  { ...wins('artiste', 'Artiste', '🎨', 'dessine-devine', 'Dessine & devine'), art: 'painter' },
  { ...wins('loup', 'Loup', '🐺', 'loup-garou', 'Loup-garou'), art: 'werewolf' },
  { ...wins('artificier', 'Artificier', '💣', 'bombe-a-mots', 'Bombe à mots'), art: 'pyro' },
  { ...wins('pirate', 'Pirate', '🏴‍☠️', 'menteur', 'Menteur'), art: 'pirate' },
  wins('bowler', 'Bowler', '🎳', 'bowling', 'Bowling'),
  { ...wins('philosophe', 'Philosophe', '🤔', 'tu-preferes', 'Tu préfères ?'), art: 'philosopher' },
  { ...wins('vedette', 'Star de cinéma', '🎬', 'qui-suis-je', 'Qui suis-je ?'), art: 'cinema' },
  { ...wins('archer', 'Archer', '🏹', 'le-plus-proche', 'Le plus proche'), art: 'archer' },
  { ...wins('comedien', 'Comédien', '🎭', 'action-ou-verite', 'Action ou vérité'), art: 'actor' },
  { ...wins('coach', 'Coach', '📣', 'devine-en-equipe', 'Devine en équipe'), art: 'coach' },
  duels('stratege', 'Stratège', '🧠', 'quatre-a-la-suite', '4 à la suite'),
  duels('ninja', 'Ninja', '🥷', 'morpion', 'Morpion'),
  duels('amiral', 'Amiral', '⚓', 'bataille-navale', 'Bataille navale'),
]

export const TENUES_BY_ID = Object.fromEntries(TENUES.map((t) => [t.id, t])) as Record<TenueId, TenueDef>

export const getTenue = (id: string | null | undefined): TenueDef | undefined =>
  id ? (TENUES_BY_ID as Record<string, TenueDef>)[id] : undefined
