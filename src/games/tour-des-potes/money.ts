/**
 * Billets du Tour des Potes (design maison) : coupures, couleurs et décompositions.
 * Pur (ni React ni three) : partagé par le portefeuille, le pot des taxes (2D / 3D)
 * et la mini-scène de loyer.
 */
export const DENOMS = [500, 100, 50, 20, 10, 5, 1] as const
export type Denom = (typeof DENOMS)[number]

/** Une couleur vive par coupure (fond / texte). */
export const BILL_STYLE: Record<Denom, { bg: string; fg: string; light: string }> = {
  500: { bg: '#8b5cf6', fg: '#ffffff', light: '#b79cff' },
  100: { bg: '#ef476f', fg: '#ffffff', light: '#ff86a1' },
  50: { bg: '#fb8500', fg: '#1f1b2e', light: '#ffb155' },
  20: { bg: '#ffb703', fg: '#1f1b2e', light: '#ffd86b' },
  10: { bg: '#06d6a0', fg: '#1f1b2e', light: '#7df0cd' },
  5: { bg: '#4cc9f0', fg: '#1f1b2e', light: '#a4e6fa' },
  1: { bg: '#ff8fa3', fg: '#1f1b2e', light: '#ffc4cf' },
}

/** Décomposition gloutonne (du 500 au 1) : nombre de billets par coupure. */
export function breakdown(amount: number): Record<Denom, number> {
  let rest = Math.max(0, Math.floor(amount))
  const out = {} as Record<Denom, number>
  for (const d of DENOMS) {
    out[d] = Math.floor(rest / d)
    rest -= out[d] * d
  }
  return out
}

const SPLIT: Record<Denom, Denom[]> = {
  500: [100, 100, 100, 100, 100],
  100: [50, 50],
  50: [20, 20, 10],
  20: [10, 10],
  10: [5, 5],
  5: [1, 1, 1, 1, 1],
  1: [1],
}

/**
 * Billets à montrer pour un montant (animation / tas) : décomposition gloutonne,
 * puis on fait de la monnaie sur le plus petit billet (> 1 €) tant qu'il y en a moins de
 * `min` (la somme reste exacte) ; au-delà de `max`, on ne montre que les plus gros.
 */
export function billsFor(amount: number, min = 4, max = 8): Denom[] {
  const b = breakdown(amount)
  const list: Denom[] = []
  for (const d of DENOMS) for (let k = 0; k < b[d]; k++) list.push(d)
  let guard = 0
  while (list.length > 0 && list.length < min && guard++ < 40) {
    let i = list.length - 1
    while (i >= 0 && list[i] <= 1) i--
    if (i < 0) break
    list.splice(i, 1, ...SPLIT[list[i]])
    list.sort((x, y) => y - x)
  }
  return list.slice(0, max)
}

const POT_MIX: Denom[] = [100, 50, 20, 100, 10, 50, 5, 100, 20, 50]

/**
 * Tas de la cagnotte : il grossit avec le montant (un billet par tranche de 50 €,
 * plafonné à `max`). Coupures mélangées pour un tas coloré : le montant exact est
 * sur l'étiquette, pas dans le tas.
 */
export function potBills(pot: number, max: number): Denom[] {
  if (pot <= 0) return []
  const n = Math.min(max, Math.max(1, Math.ceil(pot / 50)))
  return Array.from({ length: n }, (_, k) => POT_MIX[k % POT_MIX.length])
}
