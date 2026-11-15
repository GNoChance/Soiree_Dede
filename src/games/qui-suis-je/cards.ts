// Banque de cartes « Qui suis-je ? » (aussi utilisée par « Devine en équipe »).
// Contenu rempli par l'agent contenu. Le thème « soirees-dede » (les 9 persos de l'app)
// est généré à partir de src/data/characters.ts par le jeu lui-même, pas ici.
export type WhoTheme = 'celebrites' | 'films-series' | 'dessins-animes' | 'sportifs' | 'chanteurs' | 'personnages-historiques' | 'jeux-video'
export interface WhoCard {
  id: string // 'qs0001'
  name: string // « Astérix »
  theme: WhoTheme
  difficulty: 1 | 2 | 3 // 1 = tout le monde connaît
}
export const WHO_CARDS: WhoCard[] = []
