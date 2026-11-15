/**
 * Dictionnaire français de « Bombe à mots » (implémentation fournie par l'agent dictionnaire).
 * Contrat :
 * - normalizeWord(s) : minuscules, sans accents ni ligatures (œ→oe, æ→ae), lettres a-z et tirets seulement.
 * - loadDictionary() : charge (une seule fois, mis en cache) l'ensemble des mots NORMALISÉS
 *   depuis un fichier statique servi par l'app (public/dicts/...), ~300 000 formes (conjugaisons incluses).
 * - SYLLABLES : syllabes/groupes de 2-3 lettres jouables avec leur difficulté 1 (très courante) à 5 (rare)
 *   et le nombre de mots du dictionnaire qui les contiennent.
 */
export interface Syllable { s: string; level: 1 | 2 | 3 | 4 | 5; count: number }
export const SYLLABLES: Syllable[] = []
export function normalizeWord(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/œ/gi, 'oe').replace(/æ/gi, 'ae').toLowerCase().replace(/[^a-z-]/g, '')
}
export async function loadDictionary(): Promise<Set<string>> {
  return new Set()
}
