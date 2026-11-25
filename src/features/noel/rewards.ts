// Récompenses de l'événement de Noël (miroir de _noel_pass_reward / _noel_band_reward, supabase/features/noel.sql).
// Fichier sans import : vérifiable par un simple script node.

/** Récompenses des 30 paliers du Pass de Noël (miroir de _noel_pass_reward). `soon` : livré plus tard. */
export interface NoelPassReward {
  coins?: number
  itemId?: string
  label: string
  emoji: string
  soon?: boolean
}
const c = (coins: number): NoelPassReward => ({ coins, label: `${coins} pièces`, emoji: '🪙' })
export const NOEL_PASS_REWARDS: NoelPassReward[] = [
  c(30), c(30),
  { itemId: 't_lutin_chef', label: 'Titre « Lutin en chef »', emoji: '🧝' },
  c(40), c(40),
  { itemId: 'cb_papier_cadeau', label: 'Dos de cartes « Papier cadeau »', emoji: '🎁' },
  c(50), c(50),
  { itemId: 'd_sucre_orge', label: 'Dés « Sucre d’orge »', emoji: '🍭' },
  { itemId: 'fx_neige', label: 'Effet « Neige sur l’avatar »', emoji: '❄️' },
  c(60),
  { itemId: 'k_noel_traineau', label: 'Kart « Traîneau rouge »', emoji: '🛷' },
  c(60), c(70),
  { itemId: 'gb_boule_noel', label: 'Balle de golf « Boule de Noël »', emoji: '🔴' },
  c(70), c(80),
  { itemId: 'fx_traineau', label: 'Effet « Entrée en traîneau »', emoji: '🛷' },
  c(80),
  { itemId: 'bb_buche', label: 'Boule de bowling « Bûche de Noël »', emoji: '🪵' },
  c(90),
  { itemId: 'm_guirlande', label: 'Morpion « Guirlande lumineuse »', emoji: '💡' },
  c(90), c(100),
  { itemId: 'fx_sapins', label: 'Effet « Pluie de sapins »', emoji: '🎄' },
  c(100),
  { itemId: 'f_noel_houx', label: 'Cadre « Couronne de houx »', emoji: '🌿' },
  c(100), c(100),
  { coins: 200, itemId: 't_acharne_noel', label: 'Tenue Père Noël + titre « Acharné de Noël » + 200 pièces', emoji: '🎅' },
]

/** Paliers de la Grande Hotte (miroir de _noel_band_reward). */
export const NOEL_BAND_REWARDS: { label: string; emoji: string; soon?: boolean }[] = [
  { label: '100 pièces pour chacun', emoji: '🪙' },
  { label: 'Effet « Salon enneigé »', emoji: '🌨️' },
  { label: 'Cadre animé « Aurore de la bande »', emoji: '🌌' },
  { label: '250 pièces + titre « La Bande de Noël »', emoji: '🎄' },
  { label: 'Gros Lot : 500 pièces, trophée « Esprit d’équipe 2026 », thème secret « Le Réveillon de la Bande », plaque souvenir dans l’album (et la tenue Pyjama de Noël fin décembre)', emoji: '🎁' },
]
