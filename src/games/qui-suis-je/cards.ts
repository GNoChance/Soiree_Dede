// Banque de cartes « Qui suis-je ? » (aussi utilisée par « Devine en équipe »).
// Contenu réparti dans ./cards/<theme>.ts. Le thème « soirees-dede » (les 9 persos de l’app)
// est généré à partir de src/data/characters.ts par le jeu lui-même, pas ici.
import celebrites from './cards/celebrites'
import filmsSeries from './cards/films-series'
import dessinsAnimes from './cards/dessins-animes'
import sportifs from './cards/sportifs'
import chanteurs from './cards/chanteurs'
import personnagesHistoriques from './cards/personnages-historiques'
import jeuxVideo from './cards/jeux-video'
import lot2 from './cards/lot-2'

export type WhoTheme = 'celebrites' | 'films-series' | 'dessins-animes' | 'sportifs' | 'chanteurs' | 'personnages-historiques' | 'jeux-video'
export interface WhoCard {
  id: string // 'qs0001'
  name: string // « Astérix »
  theme: WhoTheme
  difficulty: 1 | 2 | 3 // 1 = tout le monde connaît
}

type ThemeData = Record<1 | 2 | 3, string>
const SOURCES: Array<[WhoTheme, ThemeData]> = [
  ['celebrites', celebrites],
  ['films-series', filmsSeries],
  ['dessins-animes', dessinsAnimes],
  ['sportifs', sportifs],
  ['chanteurs', chanteurs],
  ['personnages-historiques', personnagesHistoriques],
  ['jeux-video', jeuxVideo],
]

const raw: Omit<WhoCard, 'id'>[] = []
for (const [theme, data] of SOURCES) {
  for (const difficulty of [1, 2, 3] as const) {
    for (const name of data[difficulty].split('|')) raw.push({ name, theme, difficulty })
  }
}
// Lots suivants : toujours APRÈS les cartes d’origine (identifiants positionnels, historique « déjà jouées »).
const LOTS: Array<Record<WhoTheme, ThemeData>> = [lot2]
for (const lot of LOTS) {
  for (const [theme] of SOURCES) {
    for (const difficulty of [1, 2, 3] as const) {
      for (const name of lot[theme][difficulty].split('|')) raw.push({ name, theme, difficulty })
    }
  }
}

export const WHO_CARDS: WhoCard[] = raw.map((c, i) => ({ id: 'qs' + String(i + 1).padStart(4, '0'), ...c }))
