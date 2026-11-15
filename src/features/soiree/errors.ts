import { toast } from '@/store/toast'

/** Messages FR des erreurs métier des RPC soirée / jeux (cf. supabase/README.md). */
const MESSAGES: Record<string, string> = {
  not_authenticated: 'Connexion perdue. Recharge l’app et réessaie.',
  not_logged_in: 'Tu n’es plus connecté·e. Choisis ton personnage.',
  unknown_profile: 'Ce joueur n’existe pas.',
  already_in_soiree: 'Tu es déjà dans une soirée.',
  player_busy: 'Déjà dans une autre soirée',
  soiree_not_found: 'Aucune soirée avec ce code…',
  soiree_ended: 'Cette soirée est terminée.',
  not_host: 'Seul l’hôte peut faire ça.',
  match_in_progress: 'Une partie est déjà en cours !',
  player_not_in_soiree: 'Un joueur choisi n’est plus dans la soirée.',
  unknown_game: 'Jeu inconnu.',
  not_enough_players: 'Pas assez de joueurs pour ce jeu.',
  missing_questions: 'Il manque des questions.',
  invalid_questions: 'Questions invalides.',
  invalid_pair: 'Paire de mots invalide.',
  match_not_found: 'Partie introuvable.',
  match_not_playing: 'La partie est terminée.',
  match_already_finished: 'La partie est terminée.',
  not_in_match: 'Tu ne joues pas cette partie.',
  invalid_action: 'Action impossible.',
  unknown_action: 'Action inconnue.',
  wrong_phase: 'Trop tard (ou trop tôt) pour ça !',
  not_a_player: 'Tu ne joues pas cette partie.',
  not_alive: 'Tu as été éliminé·e : tu regardes la partie.',
  invalid_target: 'Ce joueur ne peut pas être choisi.',
  cannot_vote_self: 'Pas le droit de voter pour toi-même !',
  // Pas de bol !
  not_your_turn: 'Ce n’est pas ton tour !',
  card_not_in_hand: 'Tu n’as plus cette carte.',
  card_not_playable: 'Cette carte ne peut pas être posée maintenant.',
  invalid_color: 'Choisis une couleur.',
  too_many_players: 'Trop de joueurs pour ce jeu.',
  // Cerveau en fête
  wrong_mode: 'Cette question se joue autrement.',
  invalid_choice: 'Choix invalide.',
  // Petit bac
  invalid_categories: 'Catégories invalides.',
  // Dessine & devine
  not_drawer: 'Seul le dessinateur peut choisir le mot.',
  drawer_cannot_guess: 'Tu dessines : pas le droit de deviner !',
  already_found: 'Tu as déjà trouvé !',
  not_enough_words: 'Pas assez de mots pour cette partie.',
  // Tu préfères ?
  missing_dilemmas: 'Il manque des dilemmes.',
  invalid_dilemmas: 'Dilemmes invalides.',
  // Menteur
  invalid_bid: 'Enchère invalide.',
  bid_too_low: 'Il faut monter l’enchère !',
  paco_opening: 'On n’ouvre pas sur les 1 !',
  no_bid_yet: 'Personne n’a encore enchéri.',
  pile_disabled: 'La variante « Pile ! » n’est pas activée.',
  // Bombe à mots
  invalid_syllables: 'Syllabes invalides.',
  bomb_paused: 'Attends le top départ !',
  bomb_not_ready: 'La bombe n’a pas encore explosé.',
  too_late: 'Trop tard, la bombe a bougé !',
  invalid_word: 'Lettres uniquement (et tirets) !',
  word_missing_syllable: 'Ton mot ne contient pas la syllabe !',
  word_too_short: 'Trop court : il faut plus que la syllabe !',
  word_already_played: 'Déjà joué dans la partie !',
  // Loup-garou
  invalid_composition: 'Composition des rôles invalide.',
  already_acted: 'Tu as déjà agi cette nuit.',
  no_potion: 'Tu n’as plus cette potion.',
  // Bowling
  wrong_roll: 'Ce lancer ne correspond pas à ta feuille de score.',
  invalid_roll: 'Lancer invalide : ces quilles sont déjà tombées.',
  already_done: 'Tu as déjà fini ta partie !',
  // Qui suis-je ?
  wrong_card: 'Carte déjà validée !',
  invalid_card: 'Carte invalide.',
  missing_cards: 'Il manque des cartes.',
  not_enough_cards: 'Pas assez de cartes pour ces réglages.',
  invalid_cards: 'Cartes invalides.',
  // Le plus proche
  invalid_number: 'Ce n’est pas un nombre valide.',
  number_out_of_range: 'Nombre beaucoup trop grand !',
  // Action ou vérité
  target_cannot_vote: 'C’est ton destin : pas le droit de voter !',
  // Devine en équipe / Dessine & devine
  invalid_teams: 'Chaque équipe doit avoir au moins 2 joueurs.',
  not_speaker: 'Ce n’est pas toi l’orateur !',
  missing_words: 'Aucun mot tiré pour la partie.',
  invalid_words: 'Liste de mots invalide.',
  not_your_guess: 'Ce n’est pas à toi de deviner.',
  invalid_guess: 'Écris un mot.',
  code_generation_failed: 'Impossible de créer le code, réessaie.',
}

function raw(err: unknown): string {
  if (typeof err === 'string') return err
  if (err && typeof err === 'object' && 'message' in err) return String((err as { message: unknown }).message ?? '')
  return ''
}

/** Code métier (ex. `player_busy`) ou null. */
export function errorCode(err: unknown): string | null {
  const m = raw(err).trim()
  if (MESSAGES[m]) return m
  return Object.keys(MESSAGES).find((c) => new RegExp(`\\b${c}\\b`).test(m)) ?? null
}

/** Détails de l'erreur Postgres (ex. pseudos pour player_busy). */
export function errorDetails(err: unknown): string | null {
  if (err && typeof err === 'object' && 'details' in err) {
    const d = (err as { details: unknown }).details
    return typeof d === 'string' && d ? d : null
  }
  return null
}

export function errorMessage(err: unknown): string {
  const code = errorCode(err)
  if (code === 'player_busy') {
    const who = errorDetails(err)
    return who ? `Déjà dans une autre soirée : ${who}` : 'Un joueur est déjà dans une autre soirée.'
  }
  if (code) return MESSAGES[code]
  if (/failed to fetch|networkerror|network request|load failed/i.test(raw(err))) {
    return 'Pas de connexion au serveur. Vérifie ton réseau.'
  }
  return 'Oups, quelque chose s’est mal passé. Réessaie.'
}

/** Toast d'erreur (le toast joue déjà le son d'échec). */
export function toastError(err: unknown) {
  console.warn('[soiree]', err)
  toast.error(errorMessage(err))
}
