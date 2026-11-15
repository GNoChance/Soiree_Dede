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

export const DEFAULT_TENUE: TenueId = 'default'

export const TENUES: TenueDef[] = [
  { id: 'default', label: 'Tenue de soirée', emoji: '🎉', gameId: null, threshold: 0, condition: 'Débloquée d\'office', default: true },
  wins('star', 'Star', '🌟', 'qui-de-nous', 'Qui de nous ?'),
  wins('espion', 'Espion', '🕵️', 'undercover', 'Undercover'),
  wins('croupier', 'Croupier', '🃏', 'pas-de-bol', 'Pas de bol !'),
  wins('prof', 'Prof', '🎓', 'cerveau-en-fete', 'Cerveau en fête'),
  wins('ecolier', 'Écolier', '🎒', 'petit-bac', 'Petit bac'),
  wins('artiste', 'Artiste', '🎨', 'dessine-devine', 'Dessine & devine'),
  wins('loup', 'Loup', '🐺', 'loup-garou', 'Loup-garou'),
  wins('artificier', 'Artificier', '💣', 'bombe-a-mots', 'Bombe à mots'),
  wins('pirate', 'Pirate', '🏴‍☠️', 'menteur', 'Menteur'),
  wins('bowler', 'Bowler', '🎳', 'bowling', 'Bowling'),
  wins('philosophe', 'Philosophe', '🤔', 'tu-preferes', 'Tu préfères ?'),
  wins('vedette', 'Star de cinéma', '🎬', 'qui-suis-je', 'Qui suis-je ?'),
  wins('archer', 'Archer', '🏹', 'le-plus-proche', 'Le plus proche'),
  wins('comedien', 'Comédien', '🎭', 'action-ou-verite', 'Action ou vérité'),
  wins('coach', 'Coach', '📣', 'devine-en-equipe', 'Devine en équipe'),
  wins('stratege', 'Stratège', '🧠', 'quatre-a-la-suite', '4 à la suite'),
  wins('ninja', 'Ninja', '🥷', 'morpion', 'Morpion'),
  wins('amiral', 'Amiral', '⚓', 'bataille-navale', 'Bataille navale'),
]

export const TENUES_BY_ID = Object.fromEntries(TENUES.map((t) => [t.id, t])) as Record<TenueId, TenueDef>

export const getTenue = (id: string | null | undefined): TenueDef | undefined =>
  id ? (TENUES_BY_ID as Record<string, TenueDef>)[id] : undefined
