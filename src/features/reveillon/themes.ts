import { parisMonthDay } from '@/features/noel/season'

/**
 * Thèmes et défis surprises du mode Réveillon (supabase/features/reveillon.sql).
 * Le serveur ne connaît que les ids : il mélange ceux du thème et en pioche un à la fin de
 * chaque manche. Placeholders : {gagnant} (un gagnant de la manche), {perdant} (dernier
 * classé), {joueur} (quelqu'un du salon tiré au sort). Ajouter un défi = une ligne ici.
 */
export type ThemeId = 'noel' | 'nouvel-an' | 'surprise'

export interface ReveillonTheme {
  id: ThemeId
  name: string
  emoji: string
  tagline: string
  /** Fond de la bannière / des écrans plein écran. */
  color: string
  decor: string[]
  /** Phrase de fin (classement final, récap). */
  outro: string
}

export const THEMES: Record<ThemeId, ReveillonTheme> = {
  noel: {
    id: 'noel',
    name: 'Réveillon de Noël',
    emoji: '🎄',
    tagline: 'Des jeux tirés au sort, des défis surprises et de la magie de Noël !',
    color: '#06d6a0',
    decor: ['🎄', '🎁', '⭐', '❄️', '🦌', '🔔'],
    outro: 'Joyeux Noël à toute la tablée !',
  },
  'nouvel-an': {
    id: 'nouvel-an',
    name: 'Nouvel An',
    emoji: '🥂',
    tagline: 'On termine l’année en beauté : jeux surprises, défis et cotillons !',
    color: '#ffb703',
    decor: ['🎆', '🥂', '🎉', '✨', '🕛', '🎊'],
    outro: 'Bonne année à toutes et à tous !',
  },
  surprise: {
    id: 'surprise',
    name: 'Soirée surprise',
    emoji: '🎁',
    tagline: 'Personne ne sait ce qui va tomber : jeux au hasard et défis rigolos !',
    color: '#ff8fa3',
    decor: ['🎈', '🎉', '🎊', '🌟', '🎁', '🥳'],
    outro: 'Quelle soirée ! On remet ça quand vous voulez.',
  },
}

export const THEME_LIST: ReveillonTheme[] = [THEMES.noel, THEMES['nouvel-an'], THEMES.surprise]

export const getTheme = (id: string | null | undefined): ReveillonTheme => THEMES[(id ?? '') as ThemeId] ?? THEMES.surprise

/** Thème proposé par défaut : Noël en décembre, Nouvel An du 28 décembre au 6 janvier, sinon surprise. */
export function defaultTheme(): ThemeId {
  const { month, day } = parisMonthDay()
  if ((month === 12 && day >= 28) || (month === 1 && day <= 6)) return 'nouvel-an'
  if (month === 12) return 'noel'
  return 'surprise'
}

export interface Challenge {
  id: string
  theme: ThemeId
  emoji: string
  text: string
}

export const CHALLENGES: Challenge[] = [
  // --- Réveillon de Noël -----------------------------------------------------
  { id: 'n_renne', theme: 'noel', emoji: '🦌', text: '{perdant} imite un renne qui a perdu son traîneau pendant 10 secondes.' },
  { id: 'n_vive_le_vent', theme: 'noel', emoji: '🎶', text: 'Tout le monde chante le refrain de « Vive le vent » ensemble. La première personne qui rit recommence en solo !' },
  { id: 'n_oh_oh_oh', theme: 'noel', emoji: '🎅', text: '{gagnant} fait son plus beau « Oh oh oh ! » de Père Noël. Les autres donnent une note sur 10.' },
  { id: 'n_compliment', theme: 'noel', emoji: '💝', text: '{perdant} fait un compliment sincère à chaque personne présente.' },
  { id: 'n_bonhomme', theme: 'noel', emoji: '⛄', text: 'Bonhomme de neige ! Tout le monde se fige comme une statue de glace. La première personne qui bouge chante un chant de Noël.' },
  { id: 'n_lutin', theme: 'noel', emoji: '🧝', text: '{joueur} devient le lutin de service de {gagnant} jusqu’à la prochaine manche (un verre d’eau, un coussin… avec le sourire !).' },
  { id: 'n_cadeau', theme: 'noel', emoji: '🎁', text: '{perdant} mime le cadeau de ses rêves. Les autres ont 30 secondes pour deviner.' },
  { id: 'n_guirlande', theme: 'noel', emoji: '✨', text: 'Guirlande humaine ! Tout le monde se tient par l’épaule et se balance de gauche à droite en chantant « Petit papa Noël ».' },
  { id: 'n_souvenir', theme: 'noel', emoji: '🎄', text: '{joueur} raconte son plus beau souvenir de Noël en 30 secondes chrono.' },
  { id: 'n_trinque', theme: 'noel', emoji: '🥂', text: 'Tout le monde trinque avec la personne à sa gauche (eau, jus ou soda : ce qu’il y a dans les verres !).' },
  // --- Nouvel An ---------------------------------------------------------------
  { id: 'na_resolution', theme: 'nouvel-an', emoji: '📜', text: '{perdant} annonce une bonne résolution complètement farfelue pour l’année prochaine.' },
  { id: 'na_decompte', theme: 'nouvel-an', emoji: '🕛', text: 'Faux compte à rebours ! Tout le monde crie « 10, 9, 8… » ensemble, puis souhaite la bonne année aux personnes juste à côté.' },
  { id: 'na_voix', theme: 'nouvel-an', emoji: '🎙️', text: '{gagnant} souhaite la bonne année à chaque personne avec une voix différente.' },
  { id: 'na_danse', theme: 'nouvel-an', emoji: '💃', text: '{perdant} invente une danse spéciale Nouvel An de 10 secondes. Tout le monde la refait juste après !' },
  { id: 'na_prediction', theme: 'nouvel-an', emoji: '🔮', text: '{joueur} fait une prédiction rigolote pour l’année prochaine à chaque personne présente.' },
  { id: 'na_trinque', theme: 'nouvel-an', emoji: '🥂', text: 'Tout le monde trinque avec la personne à sa droite et lui souhaite une chose bien précise pour l’année qui vient.' },
  { id: 'na_meilleur', theme: 'nouvel-an', emoji: '🌟', text: '{gagnant} raconte son meilleur moment de l’année en 30 secondes.' },
  { id: 'na_feu', theme: 'nouvel-an', emoji: '🎆', text: 'Feu d’artifice ! Chacun imite une fusée avec la bouche. Le plus beau « boum » reçoit une ovation.' },
  { id: 'na_selfie', theme: 'nouvel-an', emoji: '📸', text: 'Photo de groupe : tout le monde prend la pose la plus ridicule possible pour le selfie de l’année.' },
  { id: 'na_trois_mots', theme: 'nouvel-an', emoji: '🗓️', text: '{perdant} résume l’année qui se termine en trois mots seulement.' },
  // --- Soirée surprise (toute l'année) -------------------------------------------
  { id: 's_poule', theme: 'surprise', emoji: '🐔', text: '{perdant} imite une poule qui vient de pondre pendant 10 secondes.' },
  { id: 's_accent', theme: 'surprise', emoji: '🗣️', text: '{joueur} parle avec un accent inventé jusqu’à la fin de la prochaine manche.' },
  { id: 's_statues', theme: 'surprise', emoji: '🕺', text: 'Statues musicales : {gagnant} fredonne un air, tout le monde danse et se fige dès que la musique s’arrête !' },
  { id: 's_compliment', theme: 'surprise', emoji: '💐', text: 'Chacun fait un compliment à la personne à sa droite. Interdit de dire « t’es sympa » !' },
  { id: 's_mime', theme: 'surprise', emoji: '🐒', text: '{perdant} mime un animal au choix. La première personne qui trouve gagne une ovation.' },
  { id: 's_robot', theme: 'surprise', emoji: '🤖', text: '{joueur} annonce le prochain jeu avec une voix de robot.' },
  { id: 's_serieux', theme: 'surprise', emoji: '😐', text: 'Concours de sérieux : tout le monde se regarde dans les yeux. La première personne qui rit fait une grimace à toute la tablée.' },
  { id: 's_ovation', theme: 'surprise', emoji: '👏', text: 'Standing ovation pour {gagnant} ! Tout le monde se lève et applaudit pendant 10 secondes.' },
  { id: 's_anniversaire', theme: 'surprise', emoji: '🎂', text: '{perdant} chante « Joyeux anniversaire » à la personne la plus proche, même si ce n’est pas son anniversaire.' },
  { id: 's_tope', theme: 'surprise', emoji: '✋', text: 'Tournée de « tope-là » : {gagnant} invente un tope-là original pour chaque personne.' },
]

export const getChallenge = (id: string | null | undefined): Challenge | undefined => CHALLENGES.find((c) => c.id === id)
export const challengeIds = (theme: ThemeId): string[] => CHALLENGES.filter((c) => c.theme === theme).map((c) => c.id)

/** Morceau de texte d'un défi : texte simple ou nom d'un joueur (mis en valeur). */
export type ChallengePart = { text: string; who?: string }

/** Remplace les placeholders par les joueurs (ids) ; repli sur le joueur tiré au sort. */
export function challengeParts(text: string, ids: { winner_id: string | null; loser_id: string | null; random_id: string | null }): ChallengePart[] {
  const map: Record<string, string | null> = {
    gagnant: ids.winner_id ?? ids.random_id,
    perdant: ids.loser_id ?? ids.random_id,
    joueur: ids.random_id,
  }
  return text.split(/(\{gagnant\}|\{perdant\}|\{joueur\})/).filter(Boolean).map((t) => {
    const m = t.match(/^\{(\w+)\}$/)
    if (!m) return { text: t }
    const who = map[m[1]]
    return who ? { text: t, who } : { text: 'Quelqu’un' }
  })
}
