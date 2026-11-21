/**
 * Records personnels du mode entraînement : rangés dans le localStorage de CE téléphone
 * (jamais envoyés au serveur). Tout est dans un try/catch : stockage bloqué = pas de record, sans erreur.
 * Pour les records « plus petit = mieux » (golf, tour de kart) on compare avec `lower`.
 */
export interface Verdict {
  /** Record battu (ou premier score enregistré). */
  beaten: boolean
  /** Premier score enregistré pour cette variante. */
  first: boolean
  /** Ancien record (null si aucun). */
  previous: number | null
}

const key = (id: string) => `entrainement:record:${id}`

export function readRecord(id: string): number | null {
  try {
    const raw = localStorage.getItem(key(id))
    if (raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

/** Compare sans écrire (testable). */
export function judge(previous: number | null, value: number, lower: boolean): Verdict {
  if (previous === null) return { beaten: true, first: true, previous: null }
  return { beaten: lower ? value < previous : value > previous, first: false, previous }
}

/** Enregistre `value` s'il bat le record ; renvoie le verdict. */
export function submitRecord(id: string, value: number, lower: boolean): Verdict {
  const v = judge(readRecord(id), value, lower)
  if (v.beaten) {
    try {
      localStorage.setItem(key(id), String(value))
    } catch {
      /* stockage bloqué */
    }
  }
  return v
}

/** Écart au par : « −2 », « +3 », « = par ». */
export const fmtDiff = (d: number) => (d === 0 ? 'pile le par' : d > 0 ? `+${d}` : `−${-d}`)

/** Temps de tour : 52,3 s ou 1:02,3. */
export const fmtLap = (sec: number) => {
  const m = Math.floor(sec / 60)
  const s = (sec - m * 60).toFixed(1).replace('.', ',')
  return m ? `${m}:${s.padStart(4, '0')}` : `${s} s`
}
