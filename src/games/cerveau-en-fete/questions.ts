// Banque de questions du quiz « Cerveau en fête » (contenu rempli par l'agent contenu).
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

export const QUESTIONS: QuizQuestion[] = []
