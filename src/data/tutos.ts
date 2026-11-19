/**
 * Vidéos « Comment on joue ? » (public/tutos/<id>.mp4, rendues par
 * promo-video → `npm run render:tutos`). Le bouton n'apparaît que pour les
 * jeux listés ici : ajouter l'id du jeu une fois son mp4 copié dans public/tutos.
 */
export const TUTO_GAME_IDS: readonly string[] = ['morpion', 'undercover', 'dessine-devine', 'quatre-a-la-suite', 'bataille-navale', 'qui-de-nous', 'tu-preferes', 'le-plus-proche', 'cerveau-en-fete', 'petit-bac', 'action-ou-verite', 'qui-suis-je', 'devine-en-equipe', 'pas-de-bol', 'bombe-a-mots', 'menteur', 'loup-garou', 'bowling', 'tour-des-potes', 'dede-kart', 'nom-de-code', 'echecs']

/** URL de la vidéo d'explication d'un jeu, ou null s'il n'y en a pas (encore). */
export function tutoUrl(gameId: string): string | null {
  return TUTO_GAME_IDS.includes(gameId) ? `/tutos/${gameId}.mp4` : null
}
