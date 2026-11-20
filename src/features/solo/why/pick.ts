/**
 * Choix du moment à expliquer : plus gros poids, puis le plus proche de la fin.
 * Anti-rabâchage : si ce type a déjà été montré aux 2 dernières défaites (`lastWhy`) et
 * qu'un autre moment est à 20 points ou moins, on prend l'autre.
 */
import type { Moment } from './types'

const endPly = (m: Moment) => Math.max(-1, ...m.steps.map((s) => s.ply))

export function rankMoments(moments: Moment[]): Moment[] {
  return [...moments].sort((p, q) => q.weight - p.weight || endPly(q) - endPly(p))
}

export function pickMoment(moments: Moment[], lastWhy: readonly string[] = []): Moment | null {
  const ranked = rankMoments(moments)
  const top = ranked[0]
  if (!top) return null
  const tired = lastWhy.length >= 2 && lastWhy.slice(-2).every((t) => t === top.type)
  if (tired) {
    const other = ranked.find((m) => m.type !== top.type && top.weight - m.weight <= 20)
    if (other) return other
  }
  return top
}
