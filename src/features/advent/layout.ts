/**
 * Plan de la façade du calendrier : 24 portes de tailles variées sur une grille 6 colonnes × 8 rangées,
 * numéros mélangés (déterministe : le même pour tout le monde, comme un vrai calendrier en carton).
 * La 24 est la plus grande : la double porte d'entrée, en bas au centre.
 */
export type DoorHinge = 'left' | 'right' | 'double'
export type DoorSize = 'sm' | 'wide' | 'tall' | 'big' | 'front'

export interface DoorDef {
  day: number
  col: number
  row: number
  w: number
  h: number
  size: DoorSize
  color: string
  hinge: DoorHinge
}

export const GRID_COLS = 6
export const GRID_ROWS = 8

/** Couleurs vives de la palette « sticker book » (une par porte, voisines toujours différentes). */
export const DOOR_COLORS = ['#ef476f', '#ffb703', '#06d6a0', '#4cc9f0', '#8b5cf6', '#ff8fa3', '#b5e61d', '#fb8500'] as const

//        jour, col, rangée, largeur, hauteur
const RAW: ReadonlyArray<readonly [number, number, number, number, number]> = [
  [7, 1, 1, 1, 2],
  [18, 2, 1, 2, 1],
  [3, 4, 1, 1, 2],
  [12, 5, 1, 2, 2],
  [21, 2, 2, 1, 2],
  [9, 3, 2, 1, 2],
  [15, 1, 3, 1, 2],
  [1, 4, 3, 1, 2],
  [5, 5, 3, 2, 1],
  [22, 2, 4, 1, 1],
  [14, 3, 4, 1, 2],
  [2, 5, 4, 1, 2],
  [19, 6, 4, 1, 2],
  [10, 1, 5, 2, 1],
  [16, 4, 5, 1, 1],
  [6, 1, 6, 2, 2],
  [23, 1, 8, 1, 1],
  [11, 2, 8, 1, 1],
  [4, 5, 6, 1, 1],
  [17, 6, 6, 1, 1],
  [13, 5, 7, 2, 1],
  [20, 5, 8, 1, 1],
  [8, 6, 8, 1, 1],
  [24, 3, 6, 2, 3],
]

const sizeOf = (day: number, w: number, h: number): DoorSize =>
  day === 24 ? 'front' : w >= 2 && h >= 2 ? 'big' : w >= 2 ? 'wide' : h >= 2 ? 'tall' : 'sm'

const touches = (a: readonly number[], b: readonly number[]) => {
  const [ac, ar, aw, ah] = a
  const [bc, br, bw, bh] = b
  const overlapX = ac < bc + bw && bc < ac + aw
  const overlapY = ar < br + bh && br < ar + ah
  const sideX = ac + aw === bc || bc + bw === ac
  const sideY = ar + ah === br || br + bh === ar
  return (sideX && overlapY) || (sideY && overlapX)
}

function build(): DoorDef[] {
  const ordered = [...RAW].sort((a, b) => a[2] - b[2] || a[1] - b[1])
  const placed: { rect: number[]; color: string }[] = []
  const colorOf = new Map<number, string>()
  ordered.forEach(([day, col, row, w, h], i) => {
    const used = new Set(placed.filter((p) => touches([col, row, w, h], p.rect)).map((p) => p.color))
    let color: string = DOOR_COLORS[(i * 3) % DOOR_COLORS.length]
    for (let k = 0; k < DOOR_COLORS.length; k++) {
      const c = DOOR_COLORS[(i * 3 + k) % DOOR_COLORS.length]
      if (!used.has(c)) {
        color = c
        break
      }
    }
    placed.push({ rect: [col, row, w, h], color })
    colorOf.set(day, color)
  })
  return RAW.map(([day, col, row, w, h]) => ({
    day,
    col,
    row,
    w,
    h,
    size: sizeOf(day, w, h),
    color: colorOf.get(day) ?? DOOR_COLORS[0],
    // Colonne de gauche : la porte s'ouvre vers la droite (sinon elle déborderait sur le mur).
    hinge: day === 24 ? 'double' : col === 1 ? 'right' : 'left',
  }))
}

export const DOORS: readonly DoorDef[] = build()

/** Statut d'une case (calculé par la page à partir des données serveur). */
export type CaseStatus = 'opened' | 'ready' | 'today' | 'future' | 'missed'
