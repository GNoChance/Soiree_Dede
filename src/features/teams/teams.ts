/**
 * Équipes de couleur partagées entre les jeux d'équipes (Nom de Code…) : 2 à 4 équipes,
 * toujours dans l'ordre rouge, bleu, vert, jaune (c'est aussi l'ordre de jeu).
 */
export type TeamColor = 'red' | 'blue' | 'green' | 'yellow'

export const TEAM_COLORS: TeamColor[] = ['red', 'blue', 'green', 'yellow']

/** Libellés et couleurs (hex, comme TEAM_META de devine-en-equipe). `text` = couleur du texte sur `color`. */
export const TEAM_INFO: Record<TeamColor, { label: string; short: string; emoji: string; color: string; soft: string; text: string }> = {
  red: { label: 'Équipe rouge', short: 'Rouges', emoji: '🔴', color: '#ef476f', soft: '#ffd6df', text: '#ffffff' },
  blue: { label: 'Équipe bleue', short: 'Bleus', emoji: '🔵', color: '#3a86ff', soft: '#d6e6ff', text: '#ffffff' },
  green: { label: 'Équipe verte', short: 'Verts', emoji: '🟢', color: '#2ec27e', soft: '#d3f5e3', text: '#ffffff' },
  yellow: { label: 'Équipe jaune', short: 'Jaunes', emoji: '🟡', color: '#ffc43d', soft: '#fff1c9', text: '#1f1b2e' },
}

export type TeamCount = 2 | 3 | 4

export function shuffle<T>(a: readonly T[]): T[] {
  const out = [...a]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Répartit `ids` au hasard dans `count` équipes équilibrées (écart d'au plus 1). */
export function distributeTeams(ids: readonly string[], count: TeamCount): Partial<Record<TeamColor, string[]>> {
  const colors = TEAM_COLORS.slice(0, count)
  const out: Partial<Record<TeamColor, string[]>> = Object.fromEntries(colors.map((c) => [c, [] as string[]]))
  shuffle(ids).forEach((id, i) => out[colors[i % count]]!.push(id))
  return out
}
