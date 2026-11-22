/**
 * Mélange pur des cartes maison dans un paquet (sans React ni alias `@/`, importable par les tests Node).
 * Règle : au plus 1 carte sur 3 est une carte de la bande (au moins 1 s'il y en a et que le lot a ≥ 3 cartes).
 */

/** Nombre de cartes maison à inclure dans un lot de `total` cartes. */
export function customQuota(total: number, available: number): number {
  if (total <= 0 || available <= 0) return 0
  return Math.min(available, Math.max(total >= 3 ? 1 : 0, Math.floor(total / 3)))
}

export function shuffled<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Compose un lot de `total` éléments : `base` (déjà tirée, la plus longue possible) complétée/réduite pour
 * laisser la place aux cartes `custom` (tirées au hasard, quota ci-dessus), puis mélange l'ensemble.
 * Si la base est trop courte, le lot est simplement plus court (comme avant).
 */
export function mergeDeck<T>(base: T[], custom: T[], total: number): T[] {
  const k = customQuota(total, custom.length)
  const picked = shuffled(custom).slice(0, k)
  return shuffled([...base.slice(0, Math.max(0, total - picked.length)), ...picked])
}
