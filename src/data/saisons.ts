/**
 * Saisons de boutique : décor, textes et grille du passe (affichage). La source de vérité des dates, des points
 * et des récompenses est le serveur (supabase/features/saisons.sql). Spec : docs/superpowers/specs/2026-11-22-saisons-boutique-design.md
 */
import { ITEMS, type ItemDef, type SeasonId } from './cadeaux'

export interface SeasonDef {
  id: SeasonId
  /** Nom affiché (« Tous au chalet »). */
  name: string
  emoji: string
  /** « d'hiver », « de printemps »… (pour « Collection d'hiver »). */
  de: string
  title: string
  subtitle: string
  /** Fond du bandeau, thème clair / sombre. */
  bgLight: string
  bgDark: string
  /** Accent principal (barre du passe, bouton Acheter) et secondaire (pastille Limité, compte à rebours). */
  accent: string
  accent2: string
  /** Couleur du texte posé sur l'accent principal (lisibilité du bouton Acheter). */
  onAccent: string
  floaters: string[]
}

export const SEASONS: Record<SeasonId, SeasonDef> = {
  hiver: {
    id: 'hiver', name: 'Tous au chalet', emoji: '⛷️', de: 'd’hiver',
    title: '⛷️ Tous au chalet !', subtitle: 'Raclette à volonté, gamelles à ski offertes.',
    bgLight: 'linear-gradient(135deg, #DDF4FF, #FFFFFF)', bgDark: 'linear-gradient(135deg, #14213D, #1D3557)',
    accent: '#1D6FA3', accent2: '#E63946', onAccent: '#FFFFFF', floaters: ['⛷️', '🧀', '❄️', '🏔️'],
  },
  printemps: {
    id: 'printemps', name: 'Le Grand Réveil', emoji: '🌷', de: 'de printemps',
    title: '🌷 Le Grand Réveil', subtitle: 'Les oiseaux chantent, les allergiques éternuent, tout le monde triche.',
    bgLight: 'linear-gradient(135deg, #EAFBE7, #FFF0F6)', bgDark: 'linear-gradient(135deg, #1B4332, #40263A)',
    accent: '#2DC653', accent2: '#FF8FAB', onAccent: '#1f1b2e', floaters: ['🌷', '🐣', '🐝', '🌦️'],
  },
  ete: {
    id: 'ete', name: 'Camping des Flots Dédé', emoji: '🏖️', de: 'd’été',
    title: '🏖️ Camping des Flots Dédé', subtitle: 'Emplacement ombragé, mauvaise foi en plein soleil.',
    bgLight: 'linear-gradient(135deg, #FFF3B0, #BDEBFF)', bgDark: 'linear-gradient(135deg, #5A3E00, #023E58)',
    accent: '#FF7B00', accent2: '#00A6D6', onAccent: '#1f1b2e', floaters: ['🏖️', '⛱️', '🍦', '🩴'],
  },
  automne: {
    id: 'automne', name: 'La Rentrée des Frissons', emoji: '🎃', de: 'd’automne',
    title: '🎃 La Rentrée des Frissons', subtitle: 'Ça sent la citrouille, le cartable neuf et la tricherie.',
    bgLight: 'linear-gradient(135deg, #FFE8CC, #E9D5FF)', bgDark: 'linear-gradient(135deg, #3D1F00, #2B1B3D)',
    accent: '#F77F00', accent2: '#7B2CBF', onAccent: '#1f1b2e', floaters: ['🎃', '🍂', '👻', '🍄'],
  },
}

export const getSeason = (id: string | null | undefined): SeasonDef | undefined => (id ? SEASONS[id as SeasonId] : undefined)

export const PASS_TIERS = 20
export const POINTS_PER_TIER = 40

/** Pièces par palier (0 = palier à cosmétique ; le 20 donne aussi un titre). Miroir de _season_tier_coins. */
export const TIER_COINS: Record<number, number> = {
  1: 20, 2: 20, 3: 20, 4: 30, 5: 0, 6: 20, 7: 30, 8: 30, 9: 30, 10: 0,
  11: 30, 12: 30, 13: 40, 14: 40, 15: 0, 16: 40, 17: 40, 18: 50, 19: 50, 20: 100,
}

/** Article exclusif d'un palier (5, 10, 15, 20) pour une saison. */
export const passItem = (season: SeasonId, tier: number): ItemDef | undefined =>
  ITEMS.find((i) => i.season === season && i.passTier === tier)

/** Les 9 articles de la collection d'une saison, triés par prix puis ordre du catalogue. */
export const collectionOf = (season: SeasonId): ItemDef[] =>
  ITEMS.filter((i) => i.season === season && i.price != null && i.passTier == null).sort((a, b) => (a.price ?? 0) - (b.price ?? 0))

/** Texte de la récompense d'un palier (« 20 🪙 », « 🎳 Boule bûcheron »…). */
export function tierRewardLabel(season: SeasonId, tier: number): string {
  const it = passItem(season, tier)
  if (!it) return `${TIER_COINS[tier] ?? 0} 🪙`
  return tier === PASS_TIERS ? `${it.emoji} Titre « ${it.label} » + ${TIER_COINS[tier]} 🪙` : `${it.emoji} ${it.label}`
}

/** « 28 février » (date de fin, dernier jour inclus) à partir de l'instant de fermeture (minuit, exclu). */
export function lastDayLabel(endsAtIso: string): string {
  const d = new Date(new Date(endsAtIso).getTime() - 3_600_000)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' })
}

/** Jours restants avant la fermeture (arrondi au-dessus) et indicateur de dernière chance. */
export function daysLeft(endsAtIso: string, now = Date.now()) {
  const ms = new Date(endsAtIso).getTime() - now
  const days = Math.max(0, Math.ceil(ms / 86_400_000))
  return { days, lastWeek: days <= 7, lastDay: days <= 1 }
}
