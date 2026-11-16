export type ExpressionId =
  | 'joie' | 'colere' | 'pleurs' | 'boude' | 'reflexion' | 'dodo'
  | 'bisou' | 'clin_oeil' | 'surprise' | 'amoureux' | 'cool' | 'gamer'
  | 'pouces' | 'timide' | 'charmee' | 'determine'

/** Compteur suivi pour la progression : colonne de player_stats, ou 'friends' (amis acceptés). */
export type ProgressStat =
  | 'wins' | 'undercover_played' | 'undercover_first_out' | 'designated_total'
  | 'max_loss_streak' | 'last_place_count' | 'soirees_count' | 'late_soirees_count'
  | 'undercover_won_as_undercover' | 'friends'

export interface ExpressionProgress {
  stat: ProgressStat
  target: number
  /** ex: « victoires » -> « 3/5 victoires » */
  unit: string
}

export interface ExpressionDef {
  progress?: ExpressionProgress
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
  pouces: { id: 'pouces', label: 'Pouces', emoji: '👍', condition: '5 victoires', progress: { stat: 'wins', target: 5, unit: "victoires" } },
  gamer: { id: 'gamer', label: 'Gamer', emoji: '🎮', condition: '25 victoires', progress: { stat: 'wins', target: 25, unit: "victoires" } },
  cool: { id: 'cool', label: 'Cool', emoji: '😎', condition: 'Être n°1 du classement général (victoires)' },
  clin_oeil: { id: 'clin_oeil', label: 'Clin d\'œil', emoji: '😉', condition: 'Gagner Undercover en étant l\'undercover', progress: { stat: 'undercover_won_as_undercover', target: 1, unit: "victoire en undercover" } },
  reflexion: { id: 'reflexion', label: 'Réflexion', emoji: '🤔', condition: '10 parties d\'Undercover jouées', progress: { stat: 'undercover_played', target: 10, unit: "parties d'Undercover" } },
  boude: { id: 'boude', label: 'Boude', emoji: '😤', condition: 'Être éliminé en premier 3 fois à Undercover', progress: { stat: 'undercover_first_out', target: 3, unit: "éliminations en premier" } },
  bisou: { id: 'bisou', label: 'Bisou', emoji: '😘', condition: 'Être désigné 10 fois dans « Qui de nous ? »', progress: { stat: 'designated_total', target: 10, unit: "désignations" } },
  timide: { id: 'timide', label: 'Timide', emoji: '😳', condition: 'Être désigné 25 fois dans « Qui de nous ? »', progress: { stat: 'designated_total', target: 25, unit: "désignations" } },
  amoureux: { id: 'amoureux', label: 'Amoureux', emoji: '😍', condition: 'Avoir 5 amis', progress: { stat: 'friends', target: 5, unit: "amis" } },
  charmee: { id: 'charmee', label: 'Charmée', emoji: '🥰', condition: 'Être ami avec les 8 autres', progress: { stat: 'friends', target: 8, unit: "amis" } },
  colere: { id: 'colere', label: 'Colère', emoji: '😡', condition: 'Perdre 3 parties d\'affilée', progress: { stat: 'max_loss_streak', target: 3, unit: "défaites d'affilée" } },
  pleurs: { id: 'pleurs', label: 'Pleurs', emoji: '😭', condition: 'Finir dernier 5 fois', progress: { stat: 'last_place_count', target: 5, unit: "fois dernier" } },
  dodo: { id: 'dodo', label: 'Dodo', emoji: '😴', condition: 'Terminer une soirée après 2h du matin (Europe/Paris)', progress: { stat: 'late_soirees_count', target: 1, unit: "soirée tardive" } },
  determine: { id: 'determine', label: 'Déterminé', emoji: '😤', condition: 'Débloquer Cool ou Gamer (tenues uniquement)' },
  surprise: { id: 'surprise', label: 'Surprise', emoji: '😮', condition: 'Participer à 10 soirées', progress: { stat: 'soirees_count', target: 10, unit: "soirées" } },
}

export const getExpression = (id: string): ExpressionDef | undefined =>
  (EXPRESSIONS as Record<string, ExpressionDef>)[id]

/** Palette commune des tenues (planches costumes, ordre des colonnes). */
export const COSTUME_EXPRESSIONS: ExpressionId[] = [
  'joie', 'colere', 'pleurs', 'boude', 'reflexion', 'dodo',
  'bisou', 'clin_oeil', 'surprise', 'pouces', 'timide', 'determine',
]

/** Expressions voisines quand l'expression équipée n'existe pas dans une palette. */
const FALLBACKS: Partial<Record<ExpressionId, ExpressionId[]>> = {
  cool: ['determine', 'gamer'],
  gamer: ['determine', 'cool'],
  determine: ['cool', 'gamer'],
  amoureux: ['bisou', 'charmee'],
  charmee: ['bisou', 'amoureux'],
  pouces: ['joie'],
  timide: ['bisou'],
}

/** Expression réellement dessinée dans la palette (repli sur une voisine, sinon joie). */
export function expressionIn(palette: readonly string[], expression: string): string {
  if (palette.includes(expression)) return expression
  for (const e of FALLBACKS[expression as ExpressionId] ?? []) if (palette.includes(e)) return e
  return 'joie'
}
