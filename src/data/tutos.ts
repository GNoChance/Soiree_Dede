/**
 * Vidéos « Comment on joue ? » (public/tutos/<id>.mp4, rendues par
 * promo-video → `npm run render:tutos`). Le bouton n'apparaît que pour les
 * jeux listés ici : ajouter l'id du jeu une fois son mp4 copié dans public/tutos.
 */
export const TUTO_GAME_IDS: readonly string[] = ['morpion', 'undercover', 'dessine-devine']

/** URL de la vidéo d'explication d'un jeu, ou null s'il n'y en a pas (encore). */
export function tutoUrl(gameId: string): string | null {
  return TUTO_GAME_IDS.includes(gameId) ? `/tutos/${gameId}.mp4` : null
}
