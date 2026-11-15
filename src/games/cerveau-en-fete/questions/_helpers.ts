import type { QuizQuestion, QuizTheme } from '../questions'

/**
 * Ligne compacte : [difficulté, énoncé, réponse, distracteurs « a;b;c », alias « x;y », options, image]
 * - options : « QCM » => typeable: false
 * - image : code ISO2 (drapeau flagcdn.com) ou « wm:Fichier.jpg|crédit|licence » (Wikimedia Commons)
 */
export type Row = [1 | 2 | 3, string, string, string, string?, string?, string?]
export type DraftQuestion = Omit<QuizQuestion, 'id'>

const split = (s?: string) => (s ? s.split(';').map((x) => x.trim()).filter(Boolean) : [])

export function build(theme: QuizTheme, rows: Row[]): DraftQuestion[] {
  return rows.map(([difficulty, prompt, answer, distractors, aliases, opts, img]) => {
    const q: DraftQuestion = {
      theme,
      difficulty,
      prompt,
      answer,
      distractors: split(distractors) as [string, string, string],
    }
    const al = split(aliases)
    if (al.length) q.aliases = al
    if (opts === 'QCM') q.typeable = false
    if (img) {
      if (img.startsWith('wm:')) {
        const [file, credit, license] = img.slice(3).split('|')
        q.image = {
          url: `https://commons.wikimedia.org/wiki/Special:FilePath/${file}?width=640`,
          credit,
          license,
        }
      } else {
        q.image = { url: `https://flagcdn.com/w320/${img}.png`, credit: 'flagcdn.com', license: 'Domaine public' }
      }
    }
    return q
  })
}
