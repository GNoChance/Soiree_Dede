/**
 * Relief de la grande montagne de Dédé 2000 (rendu seulement, aucune règle) : hauteurs en coordonnées de grille.
 * `skiAlt` = altitude des cases (lacets en terrasses, un étage = STEP, léger dôme vers les bouts des lacets) ;
 * `skiTerrain` = le massif sous les cases (mêmes terrasses sur la face, flancs qui retombent, sommets derrière).
 */

/** Dénivelé entre deux lacets (2 lignes de grille = 2,6 unités) : ~55° dans les couloirs. */
export const STEP = 1.9
/** Le Pic du Dédé (derrière la Loge du Pic, case 154 en (5 ; −12)) : position et hauteur du cône. */
export const PIC = { c: 5, r: -14.6, h: 4.6, base: 2.3 }

const sm = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const gauss = (c: number, r: number, gc: number, gr: number, s: number) => Math.exp(-((c - gc) ** 2 + (r - gr) ** 2) / (2 * s * s))

/** Face de la montagne : colonnes −9,8 à 19,8. */
const C0 = -9.8
const C1 = 19.8
const dome = (c: number) => 1 - 0.16 * ((Math.min(C1, Math.max(C0, c)) - 5) / 14.8) ** 2

/** Altitude d'un point de la face (et des cases) : terrasses plates sous les lacets (lignes paires), pente entre. */
export function skiAlt(c: number, r: number): number {
  if (r >= -0.4) return 0
  const k = Math.min(-r / 2, 6.2)
  const lo = Math.floor(k)
  return STEP * (lo + sm(0.22, 0.78, k - lo)) * dome(c)
}

/** Hauteur du massif enneigé en (colonne, ligne). */
export function skiTerrain(c: number, r: number): number {
  if (r >= -0.4) return 0
  const cc = Math.min(C1, Math.max(C0, c))
  const out = Math.abs(c - cc)
  let h = skiAlt(cc, r)
  // Derrière l'arête (ligne −12) : la crête retombe vers l'arrière.
  h *= sm(-21, -16.5, r)
  // Flancs : la face retombe en 8 colonnes, en pente douce (les terrasses s'effacent).
  if (out > 0) {
    const ramp = STEP * Math.min(6, -r / 2) * dome(cc)
    h = (h + (ramp - h) * sm(0, 2.5, out)) * (1 - sm(0.5, 8.5, out))
  }
  // Sommets derrière l'arête et épaulements sur les flancs (hors de la face, jamais sous une case).
  const back = sm(-12.5, -13.4, r)
  const flank = sm(0, 1.5, out) * sm(-0.6, -2.5, r)
  h += back * (4.2 * gauss(c, r, 5, -15, 2.6) + 3.6 * gauss(c, r, -4.5, -15.6, 3.2) + 4 * gauss(c, r, 15, -15.8, 3.2))
  h += flank * (3.2 * gauss(c, r, -14.5, -9.5, 3) + 3.2 * gauss(c, r, 24.5, -9, 3) + 1.6 * gauss(c, r, -13.5, -3.5, 2.2) + 1.6 * gauss(c, r, 23.5, -3, 2.2))
  // Bosses douces hors de la face (rochers, combes).
  h += Math.max(back, flank) * Math.sin(c * 1.7 + r * 0.6) * Math.cos(r * 2.1 - c * 0.4) * 0.35
  return Math.max(0, h)
}
