/**
 * Logique PURE de « Qui suis-je ? » (sans React ni import d'exécution, testable
 * sous Node) : cartes du thème « Les Soirées de Dédé », tirage de la file de
 * cartes, taille de police de la carte.
 */
import type { WhoCard } from './cards'
import type { QsjCard, QsjDifficulty } from './types'

export const SOIREES_THEME = 'soirees-dede'

export interface CharacterLike {
  slug: string
  firstName: string
  nickname: string
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

/** Les persos de l'app en cartes (pseudo en grand, prénom en sous-titre s'il diffère). */
export function characterCards(chars: CharacterLike[]): QsjCard[] {
  return chars.map((c) => ({
    id: `sd-${c.slug}`,
    name: c.nickname,
    theme: SOIREES_THEME,
    difficulty: 1,
    slug: c.slug,
    ...(norm(c.firstName) !== norm(c.nickname) ? { sub: c.firstName } : {}),
  }))
}

/** WhoCard (banque) → QsjCard (contrat serveur). */
export const fromWhoCard = (c: WhoCard): QsjCard => ({ id: c.id, name: c.name.trim(), theme: c.theme, difficulty: c.difficulty })

/** Filtre de difficulté ; les persos de la soirée passent toujours. */
export function matchesDifficulty(c: QsjCard, difficulty: QsjDifficulty): boolean {
  if (c.theme === SOIREES_THEME || difficulty === 'mixte') return true
  return difficulty === 'facile' ? c.difficulty === 1 : c.difficulty >= 2
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Tire une file de `count` cartes pour toute la partie :
 *  - sans doublon (id ou nom) tant que la banque le permet ;
 *  - en évitant l'historique récent (`history` = ids, du plus ancien au plus récent) :
 *    cartes jamais vues d'abord (mélangées), puis les moins récemment vues ;
 *  - si la difficulté laisse trop peu de cartes, on élargit à toute la sélection ;
 *  - banque trop petite : on reboucle sur des paquets remélangés (jamais deux fois
 *    la même carte d'affilée).
 */
export function buildCardQueue(
  pool: QsjCard[],
  difficulty: QsjDifficulty,
  count: number,
  history: string[] = [],
  rand: () => number = Math.random,
): { cards: QsjCard[]; used: string[] } {
  const byId = new Map<string, QsjCard>()
  const names = new Set<string>()
  for (const c of pool) {
    const key = norm(c.name ?? '')
    if (!key || byId.has(c.id) || names.has(key)) continue
    byId.set(c.id, c)
    names.add(key)
  }
  const all = [...byId.values()]
  if (all.length < 5) throw new Error('Pas assez de cartes pour ces thèmes.')
  let wanted = all.filter((c) => matchesDifficulty(c, difficulty))
  if (wanted.length < Math.min(count, 40)) wanted = all

  const seenAt = new Map<string, number>()
  history.forEach((id, i) => seenAt.set(id, i))
  const fresh = shuffle(wanted.filter((c) => !seenAt.has(c.id)), rand)
  const stale = wanted.filter((c) => seenAt.has(c.id)).sort((a, b) => seenAt.get(a.id)! - seenAt.get(b.id)!)
  const cards: QsjCard[] = [...fresh, ...stale].slice(0, count)
  while (cards.length < count) {
    const deck = shuffle(wanted, rand)
    if (deck.length > 1 && deck[0].id === cards[cards.length - 1]?.id) deck.push(deck.shift()!)
    cards.push(...deck.slice(0, count - cards.length))
  }
  return { cards, used: [...new Set(cards.map((c) => c.id))] }
}

/**
 * Taille de police (px) pour que `text` tienne dans une boîte w×h, mots entiers
 * (estimation : largeur moyenne d'un caractère ≈ 0.56 em en Baloo 2 extra-gras,
 * interligne 1.05). Bornée par [minPx, maxPx].
 */
export function fitFontPx(text: string, w: number, h: number, maxPx = 220, minPx = 22, charEm = 0.56, lineEm = 1.05): number {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length || w <= 0 || h <= 0) return minPx
  for (let px = maxPx; px > minPx; px -= 2) {
    const perLine = Math.floor(w / (px * charEm))
    if (perLine < 1) continue
    if (words.some((wd) => wd.length > perLine)) continue
    let lines = 1
    let cur = 0
    for (const wd of words) {
      const add = cur === 0 ? wd.length : cur + 1 + wd.length
      if (add > perLine) {
        lines++
        cur = wd.length
      } else cur = add
    }
    if (lines * px * lineEm <= h) return px
  }
  return minPx
}
