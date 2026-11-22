// Banque de questions du quiz « Cerveau en fête ».
// Les données sont réparties par thème dans ./questions/*.ts (format compact, voir _helpers.ts).
import { CINEMA } from './questions/cinema'
import { SERIES } from './questions/series'
import { MUSIQUE } from './questions/musique'
import { SPORT } from './questions/sport'
import { GEOGRAPHIE } from './questions/geographie'
import { HISTOIRE } from './questions/histoire'
import { SCIENCES } from './questions/sciences'
import { GASTRONOMIE } from './questions/gastronomie'
import { JEUX_VIDEO } from './questions/jeux-video'
import { ANIMAUX } from './questions/animaux'
import { CULTURE_POP } from './questions/culture-pop'
import { LANGUE_FRANCAISE } from './questions/langue-francaise'
import { CINEMA_2 } from './questions/cinema-2'
import { SERIES_2 } from './questions/series-2'
import { MUSIQUE_2 } from './questions/musique-2'
import { SPORT_2 } from './questions/sport-2'
import { GEOGRAPHIE_2 } from './questions/geographie-2'
import { HISTOIRE_2 } from './questions/histoire-2'
import { SCIENCES_2 } from './questions/sciences-2'
import { GASTRONOMIE_2 } from './questions/gastronomie-2'
import { JEUX_VIDEO_2 } from './questions/jeux-video-2'
import { ANIMAUX_2 } from './questions/animaux-2'
import { CULTURE_POP_2 } from './questions/culture-pop-2'
import { LANGUE_FRANCAISE_2 } from './questions/langue-francaise-2'

export type QuizTheme =
  | 'cinema' | 'series' | 'musique' | 'sport' | 'geographie' | 'histoire'
  | 'sciences' | 'gastronomie' | 'jeux-video' | 'animaux' | 'culture-pop' | 'langue-francaise'

export interface QuizQuestion {
  id: string // 'c0001'
  theme: QuizTheme
  difficulty: 1 | 2 | 3
  /** Énoncé. Peut contenir un rébus d'émojis (ex. « 🦁👑 : quel film ? »). */
  prompt: string
  /** Image optionnelle (libre de droits, URL vérifiée). */
  image?: { url: string; credit: string; license: string }
  /** Réponse canonique affichée à la révélation. */
  answer: string
  /** Autres formes acceptées en réponse tapée (sans casse/accents : la comparaison est tolérante). */
  aliases?: string[]
  /** 3 mauvaises réponses plausibles pour le mode QCM. */
  distractors: [string, string, string]
  /** false si la question n'a de sens qu'en QCM (réponse trop longue à taper). */
  typeable?: boolean
}

/**
 * Questions forcées en QCM : un distracteur serait accepté par la tolérance de
 * saisie (Louis XV/XVI, vitamine C/D, questions d'orthographe…). Liste produite
 * par le test serveur (scratchpad test-cerveau.mjs) — à relancer si la banque change.
 */
const QCM_ONLY = new Set(['c0100', 'c0340', 'c0410', 'c0413', 'c0439', 'c0510', 'c0526', 'c0582', 'c0695', 'c0696', 'c0697', 'c0718'])

export const QUESTIONS: QuizQuestion[] = [
  ...CINEMA, ...SERIES, ...MUSIQUE, ...SPORT, ...GEOGRAPHIE, ...HISTOIRE,
  ...SCIENCES, ...GASTRONOMIE, ...JEUX_VIDEO, ...ANIMAUX, ...CULTURE_POP, ...LANGUE_FRANCAISE,
  // Lot 2 : toujours en fin de liste (les identifiants c0001… servent à l'historique et à QCM_ONLY).
  ...CINEMA_2, ...SERIES_2, ...MUSIQUE_2, ...SPORT_2, ...GEOGRAPHIE_2, ...HISTOIRE_2,
  ...SCIENCES_2, ...GASTRONOMIE_2, ...JEUX_VIDEO_2, ...ANIMAUX_2, ...CULTURE_POP_2, ...LANGUE_FRANCAISE_2,
].map((q, i) => {
  const id = `c${String(i + 1).padStart(4, '0')}`
  return { ...q, id, ...(QCM_ONLY.has(id) ? { typeable: false } : {}) }
})
