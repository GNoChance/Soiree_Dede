export type ExpressionId =
  | 'joie' | 'colere' | 'pleurs' | 'boude' | 'reflexion' | 'dodo'
  | 'bisou' | 'clin_oeil' | 'surprise' | 'amoureux' | 'cool' | 'gamer'
  | 'pouces' | 'timide' | 'charmee'

export interface ExpressionDef {
  id: ExpressionId
  label: string
  emoji: string
  /** Condition de deblocage (texte FR) */
  condition: string
  /** true = debloquee d'office */
  default?: boolean
}

export const EXPRESSIONS: Record<ExpressionId, ExpressionDef> = {
  joie: { id: 'joie', label: 'Joie', emoji: '😄', condition: 'Débloquée d\'office', default: true },
  pouces: { id: 'pouces', label: 'Pouces', emoji: '👍', condition: '5 victoires' },
  gamer: { id: 'gamer', label: 'Gamer', emoji: '🎮', condition: '25 victoires' },
  cool: { id: 'cool', label: 'Cool', emoji: '😎', condition: 'Être n°1 du classement général (victoires)' },
  clin_oeil: { id: 'clin_oeil', label: 'Clin d\'œil', emoji: '😉', condition: 'Gagner Undercover en étant l\'undercover' },
  reflexion: { id: 'reflexion', label: 'Réflexion', emoji: '🤔', condition: '10 parties d\'Undercover jouées' },
  boude: { id: 'boude', label: 'Boude', emoji: '😤', condition: 'Être éliminé en premier 3 fois à Undercover' },
  bisou: { id: 'bisou', label: 'Bisou', emoji: '😘', condition: 'Être désigné 10 fois dans « Qui de nous ? »' },
  timide: { id: 'timide', label: 'Timide', emoji: '😳', condition: 'Être désigné 25 fois dans « Qui de nous ? »' },
  amoureux: { id: 'amoureux', label: 'Amoureux', emoji: '😍', condition: 'Avoir 5 amis' },
  charmee: { id: 'charmee', label: 'Charmée', emoji: '🥰', condition: 'Être ami avec les 8 autres' },
  colere: { id: 'colere', label: 'Colère', emoji: '😡', condition: 'Perdre 3 parties d\'affilée' },
  pleurs: { id: 'pleurs', label: 'Pleurs', emoji: '😭', condition: 'Finir dernier 5 fois' },
  dodo: { id: 'dodo', label: 'Dodo', emoji: '😴', condition: 'Terminer une soirée après 2h du matin (Europe/Paris)' },
  surprise: { id: 'surprise', label: 'Surprise', emoji: '😮', condition: 'Participer à 10 soirées' },
}

export const getExpression = (id: string): ExpressionDef | undefined =>
  (EXPRESSIONS as Record<string, ExpressionDef>)[id]
