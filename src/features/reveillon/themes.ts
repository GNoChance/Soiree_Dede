import { parisMonthDay } from '@/features/noel/season'

/**
 * Thèmes et défis surprises du mode Réveillon (supabase/features/reveillon.sql).
 * Le serveur ne connaît que les ids : il mélange ceux du thème et en pioche un à la fin de
 * chaque manche. Placeholders : {gagnant} (un gagnant de la manche), {perdant} (dernier
 * classé), {joueur} (quelqu'un du salon tiré au sort). Ajouter un défi = une ligne ici.
 */
export type ThemeId = 'noel' | 'nouvel-an' | 'surprise' | 'bande'

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
  // Thème SECRET (Gros Lot de la Grande Hotte de Noël) : proposé seulement à un hôte qui l'a reçu
  // (noel_gros_lot().mine côté front, _noel_gros_lot_ok dans reveillon_start côté serveur). Textes : Fable.
  bande: {
    id: 'bande',
    name: 'Le Réveillon de la Bande',
    emoji: '🛷',
    tagline: 'Vous avez rempli la Grande Hotte : voici votre réveillon secret, avec des défis rien que pour la bande !',
    color: '#74c0fc',
    decor: ['❄️', '🛷', '🎅', '🏆', '🤝', '✨'],
    outro: 'Bravo la bande : une Grande Hotte bien remplie et un réveillon dont on reparlera longtemps !',
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
  // --- Le Réveillon de la Bande (thème secret, Grande Hotte remplie ; textes Fable) ---
  { id: 'b_cri_ralliement', theme: 'bande', emoji: '📣', text: '{gagnant} invente le cri de ralliement de la bande. À trois, tout le monde le pousse en chœur, le poing levé !' },
  { id: 'b_hotte_imaginaire', theme: 'bande', emoji: '🎅', text: '{joueur} fait circuler une hotte imaginaire : chacun y glisse à voix haute un cadeau pour toute la bande (un fou rire, des vacances, une raclette géante…).' },
  { id: 'b_neige_champion', theme: 'bande', emoji: '❄️', text: 'Il neige sur {gagnant} ! Toute la bande agite les doigts comme des flocons qui tombent, pendant 10 secondes de gloire bien méritée.' },
  { id: 'b_surnom', theme: 'bande', emoji: '🏷️', text: '{joueur} raconte d’où vient son surnom dans la bande. Sans surnom, pas de panique : la bande lui en offre un tout neuf, et très gentil !' },
  { id: 'b_souvenir_bande', theme: 'bande', emoji: '💭', text: '{joueur} commence par « Vous vous souvenez de la fois où… » et raconte un souvenir de la bande en 30 secondes. Les autres ont le droit d’ajouter les détails oubliés !' },
  { id: 'b_photo_officielle', theme: 'bande', emoji: '📸', text: 'Photo officielle de la bande ! Tout le monde se serre autour de {gagnant} et crie « Flocooons ! » à la place de « ouistiti ».' },
  { id: 'b_dede_a_dit', theme: 'bande', emoji: '🎤', text: 'Dédé a dit ! {gagnant} donne trois ordres rigolos à la bande, comme à « Jacques a dit » : sans « Dédé a dit » au début, il ne faut surtout pas obéir.' },
  { id: 'b_discours_hotte', theme: 'bande', emoji: '🏆', text: '{perdant} prononce le discours officiel, qui commence par « Chère bande, nous avons rempli la Grande Hotte… » et s’improvise pendant 15 secondes. Applaudissements obligatoires !' },
  { id: 'b_flocon_or', theme: 'bande', emoji: '🏅', text: '{perdant} remet le Flocon d’or de la soirée à la personne qui l’a le plus fait rire, et explique pourquoi.' },
  { id: 'b_hymne_dede', theme: 'bande', emoji: '🎶', text: '{perdant} choisit un air que tout le monde connaît. La bande le chante en chœur en remplaçant toutes les paroles par « Dédé » !' },
  { id: 'b_compte_flocons', theme: 'bande', emoji: '🔢', text: 'La bande compte jusqu’à 10 flocons : n’importe qui dit le nombre suivant, mais une seule voix à la fois. Si deux personnes parlent en même temps, on repart à 1 (trois essais maximum) !' },
  { id: 'b_mission_couleur', theme: 'bande', emoji: '🎯', text: 'Mission express ! {joueur} annonce une couleur et toute la bande a 10 secondes pour toucher un objet de cette couleur : mission réussie si personne ne reste les mains vides.' },
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
